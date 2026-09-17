import { ethers } from "ethers";
import * as Kuru from "@kuru-labs/kuru-sdk";
import OrderBookAbi from "@kuru-labs/kuru-sdk/abi/OrderBook.json";
import MarginAccountAbi from "@kuru-labs/kuru-sdk/abi/MarginAccount.json";
import { config } from "./config";
import { rpc } from "./chain";
import { readBook as fetchBook, readVaultParams, vaultActive, log10, type Book } from "./book";
import type { Quote, QuoteStatus } from "./types";

export type { Book };

export interface QuoteResult { block: number; quote: Quote; canceled: number[] }

const ERC20_ABI = [
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

const gwei = (n: number) => ethers.utils.parseUnits(String(n), "gwei");
const BN = ethers.BigNumber;
const ZERO_ADDRESS = ethers.constants.AddressZero;

interface Pending { block: number; quote: Quote; gasLimit: ethers.BigNumber }

export class Market {
  readonly provider = new ethers.providers.StaticJsonRpcProvider(config.rpcUrl, config.chainId);
  readonly wallet = config.dryRun ? null : new ethers.Wallet(config.privateKey!, this.provider);
  params!: Kuru.MarketParams;
  margin = { mon: 0, usdc: 0 };
  private iface = new ethers.utils.Interface(OrderBookAbi.abi);
  private marginIface = new ethers.utils.Interface(MarginAccountAbi.abi);
  private nonce = 0;
  private feeWei = gwei(102);
  private gasLimit = BN.from(config.gasLimitFallback);
  private useVault = false;
  private pending = new Map<string, Pending>();
  private simId = -1;

  get address() { return this.wallet?.address ?? null; }
  get priceDec() { return log10(this.params.pricePrecision); }
  get sizeDec() { return log10(this.params.sizePrecision); }
  get tickUnits() { return Number(this.params.tickSize.toString()); }
  get lastGasUsd() {
    const mon = this.gasMon(this.gasLimit, this.feeWei);
    return mon * 0; // filled by trader from mid; expose mon
  }
  get lastGasMon() { return this.gasMon(this.gasLimit, this.feeWei); }

  async init() {
    this.params = await Kuru.ParamFetcher.getMarketParams(this.provider, config.market);
    await this.refresh();
    if (!this.wallet) return;
    await this.resyncNonce();
    await this.ensureMargin();
    await this.initGasLimit();
  }

  async refresh() {
    const [fee, vault, mon, usdc] = await Promise.allSettled([
      rpc<string>("eth_gasPrice"),
      readVaultParams(config.readRpcUrl, config.market),
      this.wallet ? this.marginBalance(ZERO_ADDRESS) : Promise.resolve(null),
      this.wallet ? this.marginBalance(this.params.quoteAssetAddress) : Promise.resolve(null),
    ]);
    if (fee.status === "fulfilled") this.feeWei = BN.from(fee.value);
    if (vault.status === "fulfilled") this.useVault = vaultActive(vault.value);
    if (mon.status === "fulfilled" && mon.value) this.margin.mon = Number(ethers.utils.formatUnits(mon.value, this.params.baseAssetDecimals.toNumber()));
    if (usdc.status === "fulfilled" && usdc.value) this.margin.usdc = Number(ethers.utils.formatUnits(usdc.value, this.params.quoteAssetDecimals.toNumber()));
  }

  readBook(): Promise<Book> {
    return fetchBook(config.readRpcUrl, config.market, this.params, { vault: this.useVault });
  }

  noneQuote(): Quote {
    return {
      bid: null, ask: null, txHash: null, gasMon: 0, cancel: [],
      status: "none", sent: false, orderIdBid: null, orderIdAsk: null,
    };
  }

  async sendBoth(
    block: number,
    bid: { price: number; size: number } | null,
    ask: { price: number; size: number } | null,
    cancel: number[],
  ): Promise<Quote> {
    if (!this.wallet) {
      return {
        bid, ask, txHash: null, gasMon: 0, cancel,
        status: "sim", sent: true,
        orderIdBid: bid ? this.simId-- : null,
        orderIdAsk: ask ? this.simId-- : null,
      };
    }
    const tx = this.buildTx(bid, ask, cancel);
    const signed = await this.wallet.signTransaction(tx);
    let hash: string;
    try {
      hash = await rpc<string>("eth_sendRawTransaction", [signed]);
      this.nonce++;
    } catch (e) {
      await this.resyncNonce().catch(() => {});
      throw e;
    }
    const quote: Quote = {
      bid, ask, txHash: hash, gasMon: this.gasMon(this.gasLimit, this.feeWei),
      cancel, status: "sent", sent: true, orderIdBid: null, orderIdAsk: null,
    };
    this.pending.set(hash, { block, quote, gasLimit: this.gasLimit });
    return quote;
  }

  async pollPending(block: number): Promise<QuoteResult[]> {
    if (!this.pending.size) return [];
    const out: QuoteResult[] = [];
    let lost = false;
    await Promise.all([...this.pending].map(async ([hash, p]) => {
      const receipt = await rpc<any>("eth_getTransactionReceipt", [hash]).catch(() => null);
      if (!this.pending.has(hash)) return;
      if (receipt) {
        this.pending.delete(hash);
        out.push(this.parseReceipt(receipt, p));
      } else if (block - p.block >= config.pendingBlocks) {
        this.pending.delete(hash);
        lost = true;
        out.push({ block: p.block, quote: { ...p.quote, status: "lost", gasMon: 0 }, canceled: [] });
      }
    }));
    if (lost) await this.resyncNonce().catch(() => {});
    return out;
  }

  buildTx(
    bid: { price: number; size: number } | null,
    ask: { price: number; size: number } | null,
    cancel: number[],
  ): ethers.providers.TransactionRequest {
    return {
      type: 2, chainId: config.chainId, to: config.market, nonce: this.nonce, gasLimit: this.gasLimit,
      maxFeePerGas: gwei(config.maxFeeGwei), maxPriorityFeePerGas: gwei(config.priorityFeeGwei),
      data: this.encode(bid, ask, cancel), value: BN.from(0),
    };
  }

  encode(
    bid: { price: number; size: number } | null,
    ask: { price: number; size: number } | null,
    cancel: number[],
  ): string {
    const px = (p: number) => BN.from(Math.round(p * 10 ** this.priceDec));
    const sz = (s: number) => ethers.utils.parseUnits(s.toFixed(this.sizeDec), this.sizeDec);
    const bp = bid ? [px(bid.price)] : [];
    const bs = bid ? [sz(bid.size)] : [];
    const sp = ask ? [px(ask.price)] : [];
    const ss = ask ? [sz(ask.size)] : [];
    return this.iface.encodeFunctionData("batchUpdate", [bp, bs, sp, ss, cancel.map((id) => BN.from(id)), true]);
  }

  private parseReceipt(r: any, p: Pending): QuoteResult {
    if (r.effectiveGasPrice) this.feeWei = BN.from(r.effectiveGasPrice);
    const gasMon = this.gasMon(p.gasLimit, BN.from(r.effectiveGasPrice ?? this.feeWei));
    const me = this.wallet!.address.toLowerCase();
    let orderIdBid: number | null = p.quote.orderIdBid;
    let orderIdAsk: number | null = p.quote.orderIdAsk;
    const canceled: number[] = [];
    const created: number[] = [];
    if (r.status !== "0x0") {
      for (const log of r.logs ?? []) {
        let ev; try { ev = this.iface.parseLog(log); } catch { continue; }
        if (ev.name === "OrderCreated" && String(ev.args.owner).toLowerCase() === me) created.push(Number(ev.args.orderId));
        if (ev.name === "OrdersCanceled" && String(ev.args.owner).toLowerCase() === me) for (const id of ev.args.orderId) canceled.push(Number(id));
      }
    }
    // OrderCreated order is bid then ask if both present (batchUpdate buy side first).
    if (created.length) {
      if (p.quote.bid) orderIdBid = created[0] ?? null;
      if (p.quote.ask) orderIdAsk = created[p.quote.bid ? 1 : 0] ?? created[0] ?? null;
    }
    const status: QuoteStatus = r.status === "0x0" ? "reverted" : "placed";
    return { block: p.block, quote: { ...p.quote, status, orderIdBid, orderIdAsk, gasMon }, canceled };
  }

  private async ensureMargin() {
    const w = this.wallet!;
    const baseDec = this.params.baseAssetDecimals.toNumber(), quoteDec = this.params.quoteAssetDecimals.toNumber();
    const [monBal, usdcBal] = await Promise.all([this.marginBalance(ZERO_ADDRESS), this.marginBalance(this.params.quoteAssetAddress)]);
    const mon = Number(ethers.utils.formatUnits(monBal, baseDec)), usdc = Number(ethers.utils.formatUnits(usdcBal, quoteDec));
    const deposit = async (token: string, amount: ethers.BigNumber, native: boolean) => {
      const tx = await w.sendTransaction({
        to: config.marginAccount, nonce: this.nonce++, value: native ? amount : BN.from(0),
        data: this.marginIface.encodeFunctionData("deposit", [w.address, token, amount]),
      });
      await tx.wait(1);
    };
    if (mon < config.marginMon) {
      const amt = ethers.utils.parseUnits((config.marginMon - mon).toFixed(6), baseDec);
      console.log(`margin: depositing ${ethers.utils.formatUnits(amt, baseDec)} MON`);
      await deposit(ZERO_ADDRESS, amt, true);
    }
    if (usdc < config.marginUsdc) {
      const token = new ethers.Contract(this.params.quoteAssetAddress, ERC20_ABI, w);
      const amt = ethers.utils.parseUnits((config.marginUsdc - usdc).toFixed(quoteDec), quoteDec);
      const have: ethers.BigNumber = await token.balanceOf(w.address);
      const dep = have.lt(amt) ? have : amt;
      if (dep.gt(0)) {
        const allowance: ethers.BigNumber = await token.allowance(w.address, config.marginAccount);
        if (allowance.lt(dep)) { const tx = await token.approve(config.marginAccount, ethers.constants.MaxUint256, { nonce: this.nonce++ }); await tx.wait(1); }
        console.log(`margin: depositing ${ethers.utils.formatUnits(dep, quoteDec)} USDC`);
        await deposit(this.params.quoteAssetAddress, dep, false);
      }
    }
    await this.refresh();
    console.log(`margin · ${this.margin.mon.toFixed(2)} MON · ${this.margin.usdc.toFixed(2)} USDC`);
  }

  private async marginBalance(token: string): Promise<ethers.BigNumber> {
    const data = this.marginIface.encodeFunctionData("getBalance", [this.wallet!.address, token]);
    const res = await rpc<string>("eth_call", [{ to: config.marginAccount, data }, "latest"], config.readRpcUrl);
    return BN.from(res);
  }

  private async initGasLimit() {
    if (config.gasLimit) { this.gasLimit = BN.from(config.gasLimit); }
    else {
      try {
        const book = await this.readBook();
        const data = this.encode(
          { price: book.bid, size: config.tradeSizeMon },
          { price: book.ask, size: config.tradeSizeMon },
          [],
        );
        const est = await this.provider.estimateGas({ to: config.market, from: this.wallet!.address, data });
        this.gasLimit = est.add(90_000).mul(115).div(100);
      } catch (e) {
        console.warn(`gas estimate failed (${(e as Error).message.slice(0, 120)}); using ${config.gasLimitFallback}`);
      }
    }
    const per = this.gasMon(this.gasLimit, this.feeWei);
    console.log(`gas limit ${this.gasLimit} · ~${per.toFixed(4)} MON per send`);
  }

  private gasMon(limit: ethers.BigNumber, feeWei: ethers.BigNumber) {
    return Number(ethers.utils.formatEther(limit.mul(feeWei)));
  }

  private async resyncNonce() {
    this.nonce = parseInt(await rpc<string>("eth_getTransactionCount", [this.wallet!.address, "latest"]), 16);
  }
}
