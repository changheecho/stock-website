# AWS Lightsail 배포 가이드

> 기준일: 2026-09-24
> 대상: Ubuntu 24.04 LTS, Node.js 22, Nginx, systemd, AWS Lightsail 서울 리전

## 배포 구성

```text
사용자 브라우저
    │ HTTPS :443
    ▼
Nginx
    │ HTTP 127.0.0.1:3000
    ▼
Node.js 서버 ── 고정 공인 IPv4 ──▶ 키움 REST API
    ├── /api/*
    ├── React 정적 파일
    └── .logs/external-api.jsonl
```

`npm run build`는 React 클라이언트와 운영용 Node 서버를 `dist/`에 만든다. `npm start`는 `dist/server/index.js`를 실행하며 기본적으로 외부에 직접 노출되지 않는 `127.0.0.1:3000`에서 수신한다. Nginx만 인터넷의 80·443 포트를 받는다.

현재 앱은 국내·해외 실투자 계좌, 종목, 시세, 순위 조회를 지원한다. 실투자 매수·매도와 주문 상태 조회는 서버에서 차단되어 있으며 모의투자 환경에서만 주문할 수 있다.

실투자 조회는 `https://api.kiwoom.com`을 사용한다. 현재 연결된 주요 TR은 다음과 같다.

| 기능 | 국내 실투자 | 해외 실투자 |
|---|---|---|
| 계좌·예수금 | `kt00018`, `kt00001` | `ust21070`, `ust21160` |
| 종목 목록 | `ka10099` | `usa10099` |
| 현재가 | `ka10001` | `usa20100` |
| 거래대금·등락률·거래량·조회 순위 | `ka10032`, `ka10027`, `ka10030`, `ka00198` | `usa20540`, `usa20510`, `usa20530`, `usa01980` |

위 TR은 키움 REST API 명세에서 실전과 모의를 모두 지원하는 것으로 확인한 조회 API다.

## 1. 배포 전 로컬 확인

프로젝트 루트에서 다음을 실행한다.

```bash
npm ci
npm run build
npm start
```

다른 터미널에서 로그인 화면 응답을 확인한다. 앱 페이지, 정적 파일, API, `/healthz`는 모두 유효한 로그인 세션이 있어야 접근할 수 있다.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login
```

`200`이 출력되면 브라우저에서 `http://127.0.0.1:3000/`을 열어 비밀번호 로그인을 확인한 뒤 `Ctrl+C`로 서버를 종료한다. `vite preview`는 로컬 미리보기용이며 운영에서는 사용하지 않는다.

## 2. Lightsail 인스턴스 생성

1. [AWS Lightsail 콘솔](https://lightsail.aws.amazon.com/)에서 **Create instance**를 선택한다.
2. 리전은 **Asia Pacific (Seoul), ap-northeast-2**를 선택한다.
3. 플랫폼은 Linux/Unix, 블루프린트는 **OS Only → Ubuntu 24.04 LTS**를 선택한다.
4. IPv4가 포함된 dual-stack 플랜을 선택한다. 최소 1GB RAM 플랜을 권장한다.
5. SSH 키를 등록하거나 기본 키를 안전한 위치에 내려받는다.
6. 인스턴스 이름을 지정하고 생성한다.

빌드 중 메모리가 부족하면 로컬 또는 CI에서 빌드한 `dist/`를 배포하거나, Lightsail 플랜을 한 단계 높인다.

## 3. 정적 IPv4 연결

인스턴스의 기본 공인 IP는 정지 후 다시 시작할 때 바뀔 수 있다. 키움에 등록하기 전에 반드시 정적 IP를 연결한다.

1. Lightsail 콘솔의 **Networking → Create static IP**를 연다.
2. 서울 리전과 생성한 인스턴스를 선택한다.
3. 정적 IP 이름을 지정하고 생성한다.
4. 인스턴스의 Networking 화면에서 공인 IPv4 옆에 고정 표시가 있는지 확인한다.

정적 IP는 인스턴스에 연결된 동안 별도 요금이 없지만, 분리된 상태로 보유하면 요금이 발생한다. 인스턴스를 교체할 때는 기존 정적 IP를 새 인스턴스에 다시 연결하면 된다.

## 4. Lightsail 방화벽 설정

인스턴스의 **Networking → IPv4 Firewall**에서 다음 규칙만 연다.

| 용도 | 프로토콜 | 포트 | 허용 범위 |
|---|---|---:|---|
| SSH | TCP | 22 | 가능하면 관리자의 공인 IP `/32` |
| HTTP | TCP | 80 | 모든 IPv4 |
| HTTPS | TCP | 443 | 모든 IPv4 |

Node 서버의 3000 포트는 열지 않는다. IPv6를 사용할 경우 IPv6 방화벽도 별도로 설정해야 한다. 사용하지 않는다면 DNS에 AAAA 레코드를 만들지 않는다.

## 5. 서버 기본 설정

SSH로 접속한다. `<STATIC_IP>`는 연결한 Lightsail 정적 IPv4로 바꾼다.

```bash
ssh -i /path/to/key.pem ubuntu@<STATIC_IP>
```

운영체제를 업데이트하고 필수 프로그램을 설치한다.

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git nginx curl ca-certificates
```

Node.js 22를 설치한다. 아래 방식은 설치 스크립트를 먼저 내려받아 확인할 수 있게 분리했다.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
less /tmp/nodesource_setup.sh
sudo bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node --version
npm --version
```

앱 전용 시스템 사용자를 만든다.

```bash
sudo useradd --system --create-home --home-dir /var/lib/stock-website --shell /usr/sbin/nologin stock-website
```

## 6. 소스 배포와 빌드

공개 저장소라면 다음처럼 복제한다. `<REPOSITORY_URL>`은 실제 Git 저장소 주소로 바꾼다.

```bash
sudo git clone <REPOSITORY_URL> /opt/stock-website
sudo chown -R stock-website:stock-website /opt/stock-website
```

비공개 저장소는 읽기 전용 deploy key를 사용하거나, 로컬에서 `scp` 또는 `rsync`로 파일을 전송한다. 개인 계정의 광범위한 Git 자격증명을 서버에 저장하지 않는다.

의존성을 설치하고 빌드한다.

```bash
cd /opt/stock-website
sudo -u stock-website npm ci
sudo -u stock-website npm run build
sudo -u stock-website mkdir -p /opt/stock-website/.logs
```

## 7. 서버 환경변수 설정

저장소의 `.env`를 서버로 복사하지 말고, systemd가 읽는 별도 파일을 만든다.

```bash
sudoedit /etc/stock-website.env
```

현재 모의투자 기능에 필요한 형식은 다음과 같다. 실제 값으로 교체하며 따옴표나 `export`는 넣지 않는다.

```dotenv
MOCK_DOMESTIC_APP_KEY=replace_me
MOCK_DOMESTIC_APP_SECRET=replace_me
MOCK_OVERSEAS_APP_KEY=replace_me
MOCK_OVERSEAS_APP_SECRET=replace_me
LIVE_DOMESTIC_APP_KEY=replace_me
LIVE_DOMESTIC_APP_SECRET=replace_me
LIVE_OVERSEAS_APP_KEY=replace_me
LIVE_OVERSEAS_APP_SECRET=replace_me
PASSWORD=replace_with_a_long_random_password
```

`PASSWORD`는 사이트 로그인 비밀번호다. 키움 키와 함께 서버의 환경 파일에만 저장하고 저장소의 `.env`를 서버로 복사하지 않는다. 세션 쿠키는 12시간 후 만료되고, 서버 재시작 시 기존 세션은 무효화된다.

파일을 앱 사용자만 읽을 수 있게 제한한다.

```bash
sudo chown root:stock-website /etc/stock-website.env
sudo chmod 640 /etc/stock-website.env
```

국내·해외에 같은 실투자 앱 키를 사용하는 계정이라면 두 `LIVE_*` 쌍에 같은 값을 설정한다. 모의·실투자 인증정보를 같은 변수에 번갈아 덮어쓰지 않는다.

## 8. systemd 서비스 설치

저장소에 포함된 서비스 파일을 설치하고 시작한다.

```bash
sudo cp /opt/stock-website/deploy/stock-website.service /etc/systemd/system/stock-website.service
sudo systemctl daemon-reload
sudo systemctl enable --now stock-website
sudo systemctl status stock-website
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login
```

문제가 있으면 최근 로그를 확인한다.

```bash
sudo journalctl -u stock-website -n 100 --no-pager
```

키움 외부 API 요청 로그는 `/opt/stock-website/.logs/external-api.jsonl`에 기록된다. 인증 헤더와 민감한 필드는 코드에서 마스킹된다. 로그가 디스크를 가득 채우지 않도록 운영 전 logrotate 또는 별도 로그 수집 설정을 추가한다.

저장소에 포함된 logrotate 설정을 설치하고 문법을 확인한다.

```bash
sudo cp /opt/stock-website/deploy/logrotate.conf /etc/logrotate.d/stock-website
sudo logrotate --debug /etc/logrotate.d/stock-website
```

## 9. 도메인과 Nginx 설정

DNS 제공자에서 도메인의 A 레코드를 Lightsail 정적 IPv4로 지정한다. 예를 들어 `stock.example.com`을 사용한다면 다음과 같다.

| 레코드 | 이름 | 값 |
|---|---|---|
| A | `stock` | Lightsail 정적 IPv4 |

Nginx 템플릿을 복사하고 `example.com`을 실제 도메인으로 바꾼다.

```bash
sudo cp /opt/stock-website/deploy/nginx.conf /etc/nginx/sites-available/stock-website
sudoedit /etc/nginx/sites-available/stock-website
sudo ln -s /etc/nginx/sites-available/stock-website /etc/nginx/sites-enabled/stock-website
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

`http://<도메인>/login`에서 로그인 화면이 열리는지 확인한다. `/healthz`도 세션 없이 접근할 수 없으므로 로그인 뒤에 점검한다.

## 10. HTTPS 적용

DNS 전파가 끝나고 HTTP 접속이 확인된 후 Certbot을 설치한다.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <DOMAIN>
sudo certbot renew --dry-run
```

브라우저에서 `https://<DOMAIN>`에 접속하고, HTTP 요청이 HTTPS로 이동하는지 확인한다.

## 11. 키움 등록용 출발 IP 검증

서버에서 다음 명령을 실행한다.

```bash
curl -4 https://checkip.amazonaws.com
```

출력된 주소가 Lightsail 콘솔의 정적 IPv4와 정확히 같은지 확인한다. 이 주소를 키움 서비스의 공인 IP 항목에 등록한다. 인스턴스 재부팅 후에도 다시 실행해 같은 값인지 확인한다.

```bash
sudo reboot
```

재접속 후 다음 항목을 점검한다.

```bash
systemctl is-active stock-website
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login
curl -4 https://checkip.amazonaws.com
```

## 12. 업데이트 배포

Git으로 배포한 경우 다음 순서로 업데이트한다.

```bash
cd /opt/stock-website
sudo -u stock-website git pull --ff-only
sudo -u stock-website npm ci
sudo -u stock-website npm run build
sudo systemctl restart stock-website
sudo systemctl status stock-website
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login
```

서비스 재시작 전 빌드가 완료되므로 빌드 실패 시 실행 중인 이전 버전은 유지된다. 큰 변경 전에는 Lightsail 스냅샷을 만들고, 배포 후 화면과 조회 API를 확인한다.

## 장애 확인 순서

| 증상 | 확인 항목 |
|---|---|
| 사이트에 접속할 수 없음 | Lightsail 80·443 방화벽, DNS A 레코드, `systemctl status nginx` |
| Nginx 502 응답 | `systemctl status stock-website`, `journalctl -u stock-website` |
| 앱은 열리지만 API 실패 | `/etc/stock-website.env`의 변수 이름, Node 서비스 재시작 여부, 외부 API 로그 |
| 키움 IP 제한 오류 | `curl -4 https://checkip.amazonaws.com` 결과와 키움 등록 IP 비교 |
| 재부팅 후 앱 중단 | `systemctl is-enabled stock-website`, 서비스 로그 |
| 빌드 중 프로세스 종료 | 메모리 부족 여부, 더 큰 플랜 또는 외부 빌드 사용 |

## 백업과 운영 점검

- Lightsail 자동 스냅샷 또는 정기 수동 스냅샷을 설정한다.
- Ubuntu 보안 업데이트를 정기적으로 적용한다.
- 인증정보를 교체하면 `/etc/stock-website.env`를 수정하고 서비스를 재시작한다.
- 정적 IP를 삭제하거나 다른 리전으로 옮기기 전에 키움 등록 정보를 먼저 갱신한다.
- 실투자 주문 기능을 별도로 구현하려면 조회 기능, 주문 금액 제한, 중복 주문 방지, 환경 표시를 먼저 검증한다.

## 공식 참고 자료

- [Lightsail 정적 IP 생성 및 연결](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html)
- [Lightsail 정적 IP 동작과 요금](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-static-ip-addresses-in-amazon-lightsail.html)
- [Lightsail 인스턴스 방화벽](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.html)
- [Lightsail DNS 레코드 설정](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-how-to-create-dns-entry.html)
- [Lightsail 인스턴스 스냅샷](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-how-to-create-a-snapshot-of-your-instance.html)
