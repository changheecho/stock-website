import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, Copy, Download, FileInput } from 'lucide-react'
import { ExcludedStocks, MarketTabs, StrategyTimeRange, StrategyToggle } from './StrategyControls'
import {
  loadStrategySettings, marketCurrentTime, MARKET_TRADING_HOURS,
  parseStrategySettings, serializeStrategySettings, STRATEGY_SETTINGS_STORAGE_KEY, validateTrailingStopSettings,
  type StrategyMarket, type StrategySettingsDocument, type TrailingStopMarketSettings,
} from './strategySettings'
import type { Environment, StockSearchItem } from './types'
import { saveServerStrategySettings } from './api'
import StrategyRuntimeStatus from './StrategyRuntimeStatus'

export default function TrailingStopSettingsPage({ environment }: { environment: Environment }) {
  const [market, setMarket] = useState<StrategyMarket>(environment.startsWith('overseas-') ? 'overseas' : 'domestic')
  const [document, setDocument] = useState<StrategySettingsDocument>(() =>
    loadStrategySettings(localStorage.getItem(STRATEGY_SETTINGS_STORAGE_KEY)))
  const [jsonText, setJsonText] = useState('')
  const [message, setMessage] = useState('')
  const [messageIsError, setMessageIsError] = useState(false)
  const settings = document.strategies.trailingStop[market]
  const validationError = validateTrailingStopSettings(market, settings)
  const hours = MARKET_TRADING_HOURS[market]

  useEffect(() => {
    let active = true
    void fetch('/api/strategies/settings').then(async (response) => {
      const data = await response.json() as { configured?: boolean; settings?: StrategySettingsDocument; message?: string }
      if (!response.ok) throw new Error(data.message || '서버 전략 설정을 불러오지 못했습니다.')
      let next = data.settings ?? loadStrategySettings(localStorage.getItem(STRATEGY_SETTINGS_STORAGE_KEY))
      if (!data.configured) { next = loadStrategySettings(localStorage.getItem(STRATEGY_SETTINGS_STORAGE_KEY)); await saveServerStrategySettings(next) }
      if (active) { setDocument(next); localStorage.setItem(STRATEGY_SETTINGS_STORAGE_KEY, serializeStrategySettings(next)) }
    }).catch((error: unknown) => { if (active) { setMessage(error instanceof Error ? error.message : '서버 전략 설정을 불러오지 못했습니다.'); setMessageIsError(true) } })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (environment === 'domestic-mock') setMarket('domestic')
    if (environment === 'overseas-mock') setMarket('overseas')
  }, [environment])

  const updateSettings = (change: Partial<TrailingStopMarketSettings>) => {
    setDocument((current) => {
      const currentStrategy = current.strategies.trailingStop
      const updatedMarket = { ...currentStrategy[market], ...change }
      const next = {
        ...current,
        strategies: { ...current.strategies, trailingStop: { ...currentStrategy, [market]: updatedMarket } },
      } as StrategySettingsDocument
      if (!validateTrailingStopSettings(market, updatedMarket)) {
        try {
          localStorage.setItem(STRATEGY_SETTINGS_STORAGE_KEY, serializeStrategySettings(next))
          void saveServerStrategySettings(next).catch((error: unknown) => { setMessage(error instanceof Error ? error.message : '서버에 전략 설정을 저장하지 못했습니다.'); setMessageIsError(true) })
        } catch {
          setMessage('브라우저에 설정을 저장하지 못했습니다.')
          setMessageIsError(true)
        }
      }
      return next
    })
    setMessage('')
  }

  const persistWholeDocument = async (next: StrategySettingsDocument, successMessage: string) => {
    try {
      await saveServerStrategySettings(next)
      localStorage.setItem(STRATEGY_SETTINGS_STORAGE_KEY, serializeStrategySettings(next))
      setDocument(next)
      setMessage(successMessage)
      setMessageIsError(false)
    } catch {
      setMessage('브라우저에 설정을 저장하지 못했습니다.')
      setMessageIsError(true)
    }
  }

  const exportSettings = () => {
    setJsonText(serializeStrategySettings(document))
    setMessage('전체 전략 설정을 아래 텍스트로 내보냈습니다.')
    setMessageIsError(false)
  }

  const copySettings = async () => {
    const text = serializeStrategySettings(document)
    setJsonText(text)
    try {
      await navigator.clipboard.writeText(text)
      setMessage('전체 전략 설정 JSON을 복사했습니다. 다른 환경의 설정 화면에 붙여넣으세요.')
      setMessageIsError(false)
    } catch {
      setMessage('클립보드에 복사하지 못했습니다. 아래 JSON을 선택해 직접 복사해 주세요.')
      setMessageIsError(true)
    }
  }

  const importSettings = () => {
    try {
      const next = parseStrategySettings(jsonText)
      void persistWholeDocument(next, '전체 전략 설정을 가져와 저장했습니다.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '전략 설정을 가져오지 못했습니다.')
      setMessageIsError(true)
    }
  }

  return <>
    <section className="page-heading strategy-page-heading">
      <div><div className="eyebrow"><span className="live-dot" />자동매도 전략</div><h1>트레일링 스탑</h1><p>평균 매입가로 활성화하고, 매수 후 최고가에서 설정한 비율만큼 하락하면 매도합니다.</p></div>
    </section>

    <StrategyRuntimeStatus />

    <div className="strategy-layout">
      <section className="strategy-card">
        <div className="strategy-card-header"><div><Activity size={19} /><div><h2>트레일링 스탑 설정</h2><p>시장별 활성화 기준과 고점 하락률을 설정합니다.</p></div></div><span className="strategy-draft-badge">설정 초안</span></div>
        <MarketTabs market={market} environment={environment} onChange={setMarket} />
        <div className="strategy-market-note"><span>{hours.label} · {hours.timeZone}</span><b>현지 현재 시각 {marketCurrentTime(market)}</b></div>
        <StrategyToggle checked={settings.enabled} onChange={(enabled) => updateSettings({ enabled })} />

        <div className="strategy-fields">
          <div className="strategy-field-block"><div className="strategy-section-title"><div><h3>작동 시간</h3><p>시장 시간대 현지 시각 기준이며 정규장 범위로 제한됩니다.</p></div></div>
            <StrategyTimeRange market={market} startTime={settings.startTime} endTime={settings.endTime} onChange={(key, value) => updateSettings({ [key]: value })} />
            <small className="strategy-hours-hint">입력 가능 시간 {hours.start}–{hours.end} ({hours.timeZone})</small>
          </div>
          <div className="strategy-percent-grid">
            <label>활성화 수익률 (%)<input type="number" min="0.1" max="100" step="0.1" value={settings.activationProfitPercent} onChange={(event) => updateSettings({ activationProfitPercent: event.target.valueAsNumber })} /></label>
            <label>고점 대비 하락률 (%)<input type="number" min="0.1" max="100" step="0.1" value={settings.drawdownPercent} onChange={(event) => updateSettings({ drawdownPercent: event.target.valueAsNumber })} /></label>
          </div>
          {validationError && <p className="strategy-validation-error" role="alert"><AlertTriangle size={15} />{validationError}</p>}
          <ExcludedStocks market={market} environment={environment} stocks={settings.excludedStocks}
            onAdd={(stock: StockSearchItem) => updateSettings({ excludedStocks: [...settings.excludedStocks, stock] })}
            onRemove={(removed) => updateSettings({ excludedStocks: settings.excludedStocks.filter((stock) => stock.code !== removed.code || stock.market !== removed.market) })} />
        </div>
        <div className="strategy-execution-note"><AlertTriangle size={17} /><span><b>주문 기준 안내</b>활성화 수익률은 평균 매입가 대비 기준입니다. 활성화 후 고점 대비 하락률에 도달하면 매도 가능 수량 전량을 시장가로 매도하는 방식입니다. 이 화면은 현재 설정 UI만 제공하고 자동 주문은 수행하지 않습니다.</span></div>
      </section>

      <section className="strategy-card strategy-transfer-card">
        <div className="strategy-card-header"><div><FileInput size={19} /><div><h2>전체 전략 설정 백업</h2><p>SL / TP와 트레일링 스탑을 한 JSON 문서로 관리합니다.</p></div></div></div>
        <div className="strategy-transfer-actions"><button type="button" onClick={exportSettings}><Download size={15} />전체 설정 내보내기</button><button type="button" onClick={() => void copySettings()}><Copy size={15} />JSON 복사</button><button type="button" onClick={importSettings} disabled={!jsonText.trim()}>텍스트 가져오기</button></div>
        <label className="strategy-json-label">전략 설정 JSON<textarea value={jsonText} onChange={(event) => setJsonText(event.target.value)} placeholder="JSON 복사 버튼으로 전체 설정을 복사하거나, 다른 환경에서 복사한 설정을 여기에 붙여넣으세요." spellCheck={false} /></label>
        <p className={messageIsError ? 'strategy-transfer-message error' : 'strategy-transfer-message'} role="status">{message}</p>
      </section>
    </div>
  </>
}
