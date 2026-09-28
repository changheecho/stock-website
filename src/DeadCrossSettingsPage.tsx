import { useEffect, useState } from 'react'
import { AlertTriangle, Copy, Download, FileInput, LineChart } from 'lucide-react'
import { ChartPeriodSettings, ExcludedStocks, MarketTabs, StrategyTimeRange, StrategyToggle } from './StrategyControls'
import {
  loadStrategySettings, marketCurrentTime, MARKET_TRADING_HOURS,
  parseStrategySettings, serializeStrategySettings, STRATEGY_SETTINGS_STORAGE_KEY, validateDeadCrossSettings,
  type DeadCrossMarketSettings, type StrategyMarket, type StrategySettingsDocument,
} from './strategySettings'
import type { Environment, StockSearchItem } from './types'
import { saveServerStrategySettings } from './api'
import StrategyRuntimeStatus from './StrategyRuntimeStatus'

export default function DeadCrossSettingsPage({ environment }: { environment: Environment }) {
  const [market, setMarket] = useState<StrategyMarket>(environment.startsWith('overseas-') ? 'overseas' : 'domestic')
  const [document, setDocument] = useState<StrategySettingsDocument>(() =>
    loadStrategySettings(localStorage.getItem(STRATEGY_SETTINGS_STORAGE_KEY)))
  const [jsonText, setJsonText] = useState('')
  const [message, setMessage] = useState('')
  const [messageIsError, setMessageIsError] = useState(false)
  const settings = document.strategies.deadCross[market]
  const validationError = validateDeadCrossSettings(market, settings)
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

  const updateSettings = (change: Partial<DeadCrossMarketSettings>) => {
    setDocument((current) => {
      const currentStrategy = current.strategies.deadCross
      const updatedMarket = { ...currentStrategy[market], ...change }
      const next = {
        ...current,
        strategies: { ...current.strategies, deadCross: { ...currentStrategy, [market]: updatedMarket } },
      } as StrategySettingsDocument
      if (!validateDeadCrossSettings(market, updatedMarket)) {
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

  const updateMaPeriod = (key: 'shortMAPeriod' | 'longMAPeriod', value: number) =>
    updateSettings({ [key]: value })

  return <>
    <section className="page-heading strategy-page-heading">
      <div><div className="eyebrow"><span className="live-dot" />자동매도 전략</div><h1>데드크로스</h1><p>완료된 차트 봉의 종가를 사용해 단기·장기 단순 이동평균 하향 교차를 감시합니다.</p></div>
    </section>

    <StrategyRuntimeStatus />

    <div className="strategy-layout">
      <section className="strategy-card">
        <div className="strategy-card-header"><div><LineChart size={19} /><div><h2>데드크로스 설정</h2><p>시장별 차트 주기와 이동평균 봉 개수를 설정합니다.</p></div></div><span className="strategy-draft-badge">설정 초안</span></div>
        <MarketTabs market={market} environment={environment} onChange={setMarket} />
        <div className="strategy-market-note"><span>{hours.label} · {hours.timeZone}</span><b>현지 현재 시각 {marketCurrentTime(market)}</b></div>
        <StrategyToggle checked={settings.enabled} onChange={(enabled) => updateSettings({ enabled })} />

        <div className="strategy-fields">
          <div className="strategy-field-block"><div className="strategy-section-title"><div><h3>작동 시간</h3><p>시장 시간대 현지 시각 기준이며 정규장 범위로 제한됩니다.</p></div></div>
            <StrategyTimeRange market={market} startTime={settings.startTime} endTime={settings.endTime} onChange={(key, value) => updateSettings({ [key]: value })} />
            <small className="strategy-hours-hint">입력 가능 시간 {hours.start}–{hours.end} ({hours.timeZone})</small>
          </div>

          <div className="strategy-field-block"><div className="strategy-section-title"><div><h3>봉 주기</h3><p>키움 차트 명세에 선택 가능한 주기만 표시합니다.</p></div></div>
            <ChartPeriodSettings market={market} barType={settings.barType} barInterval={settings.barInterval}
              onChange={(barType, barInterval) => updateSettings({ barType, barInterval })} />
            {market === 'overseas' && <small className="strategy-hours-hint">미국 틱·분 차트 TR은 존재하지만 명세에 허용 간격 값이 기재되지 않아 선택지에서 제외했습니다.</small>}
          </div>

          <div className="strategy-ma-periods">
            <label>단기 이동평균 기간 (완료 봉 개수)<input type="number" min="1" step="1" value={settings.shortMAPeriod} onChange={(event) => updateMaPeriod('shortMAPeriod', event.target.valueAsNumber)} /></label>
            <label>장기 이동평균 기간 (완료 봉 개수)<input type="number" min="2" step="1" value={settings.longMAPeriod} onChange={(event) => updateMaPeriod('longMAPeriod', event.target.valueAsNumber)} /></label>
          </div>
          {validationError && <p className="strategy-validation-error" role="alert"><AlertTriangle size={15} />{validationError}</p>}
          <p className="strategy-data-range-note">단기 기간은 장기 기간보다 작아야 합니다. 차트 명세는 시작일·기준일 및 연속조회 방식을 제공하지만 고정된 최대 봉 개수는 정하지 않습니다. 실제 실행 시 장기 기간이 조회된 완료 봉 수를 넘지 않는지 확인해야 합니다.</p>
          <ExcludedStocks market={market} environment={environment} stocks={settings.excludedStocks}
            onAdd={(stock: StockSearchItem) => updateSettings({ excludedStocks: [...settings.excludedStocks, stock] })}
            onRemove={(removed) => updateSettings({ excludedStocks: settings.excludedStocks.filter((stock) => stock.code !== removed.code || stock.market !== removed.market) })} />
        </div>
        <div className="strategy-execution-note"><AlertTriangle size={17} /><span><b>매도 기준 안내</b>이동평균은 완료된 봉의 종가를 사용하는 단순 이동평균입니다. 단기선이 장기선을 위에서 아래로 돌파하면 매도 가능 수량 전량을 시장가로 매도하는 방식입니다. 이 화면은 현재 설정 UI만 제공하고 자동 주문은 수행하지 않습니다.</span></div>
      </section>

      <section className="strategy-card strategy-transfer-card">
        <div className="strategy-card-header"><div><FileInput size={19} /><div><h2>전체 전략 설정 백업</h2><p>SL / TP, 트레일링 스탑, 데드크로스를 한 JSON 문서로 관리합니다.</p></div></div></div>
        <div className="strategy-transfer-actions"><button type="button" onClick={exportSettings}><Download size={15} />전체 설정 내보내기</button><button type="button" onClick={() => void copySettings()}><Copy size={15} />JSON 복사</button><button type="button" onClick={importSettings} disabled={!jsonText.trim()}>텍스트 가져오기</button></div>
        <label className="strategy-json-label">전략 설정 JSON<textarea value={jsonText} onChange={(event) => setJsonText(event.target.value)} placeholder="JSON 복사 버튼으로 전체 설정을 복사하거나, 다른 환경에서 복사한 설정을 여기에 붙여넣으세요." spellCheck={false} /></label>
        <p className={messageIsError ? 'strategy-transfer-message error' : 'strategy-transfer-message'} role="status">{message}</p>
      </section>
    </div>
  </>
}
