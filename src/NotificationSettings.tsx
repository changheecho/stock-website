import { useEffect, useState } from 'react'
import { Bell, LoaderCircle, Save } from 'lucide-react'

type Settings = { chatId: string; login: boolean; buyFill: boolean; sellFill: boolean }
type SettingsResponse = { settings: Settings; configured: boolean; message?: string }

const emptySettings: Settings = { chatId: '', login: true, buyFill: true, sellFill: true }

export default function NotificationSettings() {
  const [settings, setSettings] = useState(emptySettings)
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/settings/telegram', { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (response.status === 401) { window.location.replace('/login'); throw new Error('로그인이 필요합니다.') }
        const data = await response.json() as SettingsResponse
        if (!response.ok) throw new Error(data.message || '알림 설정을 불러오지 못했습니다.')
        if (active) { setSettings(data.settings); setConfigured(data.configured) }
      })
      .catch((cause: unknown) => {
        if (active) { setError(true); setMessage(cause instanceof Error ? cause.message : '알림 설정을 불러오지 못했습니다.') }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true); setMessage(''); setError(false)
    try {
      const response = await fetch('/api/settings/telegram', {
        method: 'PUT', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(settings),
      })
      if (response.status === 401) { window.location.replace('/login'); return }
      const data = await response.json() as SettingsResponse
      if (!response.ok) throw new Error(data.message || '설정을 저장하지 못했습니다.')
      setSettings(data.settings); setConfigured(data.configured); setMessage('알림 설정을 저장했습니다.')
    } catch (cause) {
      setError(true); setMessage(cause instanceof Error ? cause.message : '설정을 저장하지 못했습니다.')
    } finally { setSaving(false) }
  }

  const update = (key: keyof Omit<Settings, 'chatId'>) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setSettings((current) => ({ ...current, [key]: event.target.checked }))

  return <>
    <section className="page-heading"><div><div className="eyebrow"><span className="live-dot" />알림 설정</div><h1>텔레그램 알림</h1><p>로그인과 모의투자 체결 알림을 종류별로 관리합니다.</p></div></section>
    {loading ? <div className="notification-loading"><LoaderCircle className="spin" size={20} /> 설정을 불러오는 중입니다.</div> : <form className="notification-settings" onSubmit={(event) => void save(event)}>
      <div className={`telegram-status ${configured ? 'connected' : 'disconnected'}`}><Bell size={19} /><div><b>{configured ? 'Telegram 봇 연결됨' : '봇 토큰이 설정되지 않았습니다'}</b><span>{configured ? '알림은 서버에서 안전하게 전송됩니다.' : '서버 환경변수 TELEGRAM_BOT_TOKEN을 설정해 주세요.'}</span></div></div>
      <label className="chat-id-field">Telegram chat_id<input value={settings.chatId} onChange={(event) => setSettings((current) => ({ ...current, chatId: event.target.value }))} inputMode="numeric" required pattern="-?[0-9]+" /></label>
      <div className="notification-options">
        <label className="notification-option"><span><b>로그인</b><small>비밀번호 로그인이 성공하면 알림을 보냅니다.</small></span><input type="checkbox" checked={settings.login} onChange={update('login')} /></label>
        <label className="notification-option"><span><b>매수 체결</b><small>매수 주문의 전체 체결이 확인되면 알림을 보냅니다.</small></span><input type="checkbox" checked={settings.buyFill} onChange={update('buyFill')} /></label>
        <label className="notification-option"><span><b>매도 체결</b><small>매도 주문의 전체 체결이 확인되면 알림을 보냅니다.</small></span><input type="checkbox" checked={settings.sellFill} onChange={update('sellFill')} /></label>
      </div>
      <div className="notification-footer"><span role="status" className={error ? 'notification-error' : 'notification-success'}>{message}</span><button className="refresh-button" type="submit" disabled={saving}><Save size={15} />{saving ? '저장 중' : '설정 저장'}</button></div>
    </form>}
  </>
}
