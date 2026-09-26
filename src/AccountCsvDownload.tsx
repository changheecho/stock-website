import { Download } from 'lucide-react'
import { createAccountCsv, createAccountCsvFilename } from './accountCsv'
import type { AccountView, Environment } from './types'

type Props = {
  account: AccountView
  environment: Environment
}

export default function AccountCsvDownload({ account, environment }: Props) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([createAccountCsv(account)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = createAccountCsvFilename(environment)
    link.click()
    URL.revokeObjectURL(url)
  }

  return <button className="csv-download-button" type="button" onClick={download} disabled={!account.holdings.length}>
    <Download size={14} /> CSV 다운로드
  </button>
}
