import type { AccountView, Environment } from './types'

type ApiRecord = Record<string, unknown>
const number = (value: unknown) => Number(String(value ?? '0').replaceAll(',', '').replace(/^\+/, '')) || 0
const text = (value: unknown) => String(value ?? '').trim()

const normalizeDomestic = (data: ApiRecord, cash: ApiRecord): AccountView => ({
  currency: 'KRW',
  totalPurchase: number(data.tot_pur_amt),
  totalEvaluation: number(data.tot_evlt_amt),
  totalProfitLoss: number(data.tot_evlt_pl),
  totalReturnRate: number(data.tot_prft_rt),
  estimatedAssets: number(data.prsm_dpst_aset_amt),
  cashBalance: number(cash.entr),
  cashCurrency: 'KRW',
  availableAmount: number(cash.ord_alow_amt),
  availableCurrency: 'KRW',
  availableLabel: '주문 가능 금액',
  holdings: ((data.acnt_evlt_remn_indv_tot as ApiRecord[] | undefined) ?? []).map((item) => ({
    code: text(item.stk_cd).replace(/^[AJQ]/, ''),
    name: text(item.stk_nm),
    quantity: number(item.rmnd_qty),
    availableQuantity: number(item.trde_able_qty),
    purchasePrice: number(item.pur_pric),
    currentPrice: number(item.cur_prc),
    evaluationAmount: number(item.evlt_amt),
    profitLoss: number(item.evltv_prft),
    returnRate: number(item.prft_rt),
    weight: number(item.poss_rt),
  })),
})

const normalizeOverseas = (data: ApiRecord, cash: ApiRecord): AccountView => ({
  currency: 'USD',
  totalPurchase: number(data.tot_prch_amt),
  totalEvaluation: number(data.tot_evlt_amt),
  totalProfitLoss: number(data.tot_pl_amt),
  totalReturnRate: number(data.tot_pl_rt),
  cashBalance: number(cash.d0_usd_fx_entr),
  cashCurrency: 'USD',
  availableAmount: number(cash.d0_won_conv_alow_ch),
  availableCurrency: 'KRW',
  availableLabel: '원화 환산 인출 가능',
  holdings: ((data.result_list as ApiRecord[] | undefined) ?? []).map((item) => ({
    code: text(item.stk_cd),
    name: text(item.frgn_stk_nm),
    quantity: number(item.poss_qty),
    availableQuantity: number(item.sell_alowq),
    purchasePrice: number(item.frgn_stk_book_uv),
    currentPrice: number(item.now_pric),
    evaluationAmount: number(item.evlt_amt),
    profitLoss: number(item.pl_amt),
    returnRate: number(item.pl_rt),
    exchange: text(item.stex_nm),
  })),
})

export async function fetchAccount(environment: Exclude<Environment, 'live'>): Promise<AccountView> {
  const response = await fetch(`/api/account?environment=${environment}`, { headers: { accept: 'application/json' } })
  const data = (await response.json()) as ApiRecord
  if (!response.ok) throw new Error(text(data.message) || '계좌 정보를 불러오지 못했습니다.')
  const portfolio = (data.portfolio ?? {}) as ApiRecord
  const cashBalance = (data.cashBalance ?? {}) as ApiRecord
  return environment === 'domestic-mock'
    ? normalizeDomestic(portfolio, cashBalance)
    : normalizeOverseas(portfolio, cashBalance)
}
