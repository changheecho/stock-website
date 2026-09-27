import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CircleCheck, LoaderCircle, PauseCircle, RefreshCw, ShieldCheck } from 'lucide-react'

type RuntimePosition = { environment: string; code: string; exchange: string; status: string; quantity: number; orderNo?: string; triggeredBy?: string[]; reason?: string; updatedAt: string }
type RuntimeStatus = { tradingEnabled: boolean; feed: Record<string, boolean>; lastError: string | null; positions: RuntimePosition[] }

const stateLabels: Record<string, string> = {
  monitoring: '감시 중', pending: '매도 주문 확인 중', unknown: '주문 결과 확인 필요',
  'paused-external-change': '계좌 변경으로 일시 중지', 'paused-failure': '실패로 일시 중지', completed: '매도 완료',
}

export default function StrategyRuntimeStatus() {
  const query = useQuery({ queryKey: ['strategy-runtime'], queryFn: async () => {
    const response = await fetch('/api/strategies/status', { headers: { accept: 'application/json' } })
    if (response.status === 401) window.location.replace('/login')
    const data = await response.json() as RuntimeStatus & { message?: string }
    if (!response.ok) throw new Error(data.message || '전략 상태를 불러오지 못했습니다.')
    return data
  }, refetchInterval: 5_000 })

  const resume = async (position: RuntimePosition) => {
    const params = new URLSearchParams({ environment: position.environment, code: position.code, exchange: position.exchange })
    const response = await fetch(`/api/strategies/resume?${params}`, { method: 'POST' })
    const data = await response.json() as { message?: string }
    if (!response.ok) throw new Error(data.message || '감시를 다시 시작하지 못했습니다.')
    await query.refetch()
  }

  return <section className="strategy-runtime-status" aria-live="polite">
    <div className="strategy-runtime-heading"><ShieldCheck size={18} /><div><b>자동매도 실행 상태</b><small>{query.data?.tradingEnabled ? '모의 주문 허용 · 실투자 주문은 차단' : '관찰 모드 · 자동 주문은 전송되지 않음'}</small></div>{query.isFetching && <LoaderCircle className="spin" size={15} />}</div>
    {query.isError && <p className="strategy-runtime-error"><AlertTriangle size={14} />{query.error.message}</p>}
    {query.data?.lastError && <p className="strategy-runtime-error"><AlertTriangle size={14} />{query.data.lastError}</p>}
    <div className="strategy-feed-health">
      {(['domestic-mock', 'overseas-mock'] as const).map((environment) => <span key={environment} className={query.data?.feed[environment] ? 'healthy' : 'unhealthy'}>{query.data?.feed[environment] ? <CircleCheck size={13} /> : <PauseCircle size={13} />}{environment === 'domestic-mock' ? '국내 실시간 연결' : '해외 실시간 연결'} {query.data?.feed[environment] ? '정상' : '대기'}</span>)}
    </div>
    {query.data?.positions.filter((item) => item.status !== 'completed' && (item.status !== 'monitoring' || item.reason)).map((item) => <div className="strategy-runtime-item" key={`${item.environment}:${item.exchange}:${item.code}`}>
      <div><b>{item.code} · {stateLabels[item.status] ?? item.status}</b><small>{item.reason || (item.orderNo ? `주문번호 ${item.orderNo}` : '')}</small></div>
      {item.status.startsWith('paused-') && <button type="button" onClick={() => void resume(item)}><RefreshCw size={13} />계좌 확인 후 재개</button>}
    </div>)}
  </section>
}
