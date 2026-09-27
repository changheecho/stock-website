import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, Download, FileInput } from 'lucide-react'
import { ExcludedStocks, MarketTabs, StrategyTimeRange, StrategyToggle } from './StrategyControls'
import {
  loadStrategySettings, marketCurrentTime, MARKET_TRADING_HOURS,
  parseStrategySettings, serializeStrategySettings, STRATEGY_SETTINGS_STORAGE_KEY, validateTrailingStopSettings,
  type StrategyMarket, type StrategySettingsDocument, type TrailingStopMarketSettings,
} from './strategySettings'
import type { Environment, StockSearchItem } from './types'

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
        try { localStorage.setItem(STRATEGY_SETTINGS_STORAGE_KEY, serializeStrategySettings(next)) } catch {
          setMessage('브라우저에 설정을 저장하지 못했습니다.')
          setMessageIsError(true)
        }
      }
      return next
    })
    setMessage('')
  }

  const persistWholeDocument = (next: StrategySettingsDocument, successMessage: string) => {
    try {
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

  const importSettings = () => {
    try {
      const next = parseStrategySettings(jsonText)
      persistWholeDocument(next, '전체 전략 설정을 가져와 저장했습니다.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '전략 설정을 가져오지 못했습니다.')
      setMessageIsError(true)
    }
  }

  return <>
    <section className="page-heading strategy-page-heading">
      <div><div className="eyebrow"><span className="live-dot" />자동매도 전략</div><h1>트레일링 스탑</h1><p>수익 보호 전략의 설정 화면입니다. 현재는 설정 인터페이스만 제공하며 주문은 실행되지 않습니다.</p></div>
    </section>

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
        <div className="strategy-transfer-actions"><button type="button" onClick={exportSettings}><Download size={15} />전체 설정 내보내기</button><button type="button" onClick={importSettings} disabled={!jsonText.trim()}>텍스트 가져오기</button></div>
        <label className="strategy-json-label">전략 설정 JSON<textarea value={jsonText} onChange={(event) => setJsonText(event.target.value)} placeholder="내보내기를 누르면 전체 설정 JSON이 표시됩니다. JSON을 붙여넣어 가져올 수도 있습니다." spellCheck={false} /></label>
        <p className={messageIsError ? 'strategy-transfer-message error' : 'strategy-transfer-message'} role="status">{message}</p>
      </section>
    </div>
  </>
}
