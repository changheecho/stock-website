# 키움 실투자용 고정 공인 IP 배포 서비스 비교

> 조사 기준일: 2026-09-24
> 가격은 세금, 환율, 초과 트래픽, 도메인 비용을 제외한 월 예상 최소 비용이다. 서비스 정책과 가격은 바뀔 수 있으므로 실제 생성 직전에 공식 가격표를 다시 확인해야 한다.

## 먼저 확인할 점

키움에 등록해야 하는 주소는 사용자가 사이트에 접속할 때 사용하는 주소가 아니라, **배포된 서버가 키움 REST API를 호출할 때 사용하는 출발 공인 IPv4 주소**다. 따라서 아래 조건을 모두 만족해야 한다.

- 키움 API 호출은 브라우저가 아니라 서버에서 수행한다.
- 서버의 외부 통신(outbound/egress)에 고정 IPv4가 사용된다.
- 앱 키와 시크릿은 서버 환경변수나 비밀 저장소에만 둔다.
- 배포 후 서버에서 확인한 출발 IPv4를 키움 서비스에 등록한다.
- 서버 또는 리전을 교체하기 전에 IP 변경 여부를 확인한다.

이 프로젝트에는 Lightsail용 운영 Node HTTP 서버와 systemd·Nginx 설정 템플릿이 포함되어 있다. 구체적인 설치 방법은 [AWS Lightsail 배포 가이드](./aws-lightsail-deployment.md)를 따른다. 국내·해외 실투자 환경에서는 계좌, 종목, 시세, 순위 조회만 지원하며 매수·매도와 주문 상태 조회는 서버에서 차단한다.

## 서비스 비교

난이도는 이 프로젝트를 혼자 운영한다는 전제에서 `낮음 / 보통 / 높음`으로 평가했다.

| 서비스 | 월 예상 최소 비용 | 고정 IP 방식 | 사용 난이도 | 필요한 개발·운영 지식 | 비교 |
|---|---:|---|---|---|---|
| **AWS Lightsail** | **US$5~7** | 인스턴스에 Lightsail 정적 IP 연결 | 보통 | Linux, SSH, Node.js 운영, systemd 또는 PM2, Nginx/Caddy, DNS·TLS, 방화벽 | **가장 추천.** 서울 리전을 지원하고 비용이 낮으며, 정적 IP를 계정에 보유한 채 인스턴스에 연결할 수 있다. 서버 보안 패치와 장애 대응은 직접 해야 한다. 512MB 플랜은 빌드 중 메모리가 빠듯할 수 있어 1GB 플랜(US$7)이 안전하다. |
| **DigitalOcean Droplet** | **US$6** (1GB) | Droplet의 공인 IPv4 또는 Reserved IP | 보통~높음 | Linux, SSH, Node.js 운영, Nginx/Caddy, DNS·TLS, 네트워크 라우팅 | 관리 화면과 문서가 이해하기 쉽다. Reserved IP를 실제 **출발 IP**로 쓰려면 게이트웨이 설정을 영구 적용해야 해서 Lightsail보다 네트워크 작업이 많다. 한국 리전은 없으므로 가까운 싱가포르 리전을 고려한다. |
| **Railway Pro** | **US$20 최소 사용료** | 서비스에서 Static Outbound IP 활성화 | 낮음 | Git 배포, 빌드·시작 명령, 환경변수, 기본적인 로그 확인 | 서버 관리 부담이 가장 적은 편이다. 정적 outbound IP는 Pro 플랜 기능이며 리전을 바꾸면 IP가 바뀐다. 현재 문서상 여러 IP로 분산될 수 있고 전용 IP를 보장하지 않으므로, 키움에 복수 IP 등록이 가능한지 먼저 확인해야 한다. |
| **Render Pro + Web Service + Dedicated IP** | **약 US$132부터** (Pro US$25 + Starter US$7 + IP 세트 US$100) | 리전별 전용 outbound IPv4 3개 세트 | 낮음 | Git 배포, 빌드·시작 명령, 환경변수, 기본적인 로그 확인 | 배포는 쉽고 IP가 워크스페이스 전용이다. 다만 단일 소규모 사이트에는 비용이 매우 높고, 요청마다 세 IP 중 하나가 사용될 수 있어 키움에 세 주소를 모두 등록해야 한다. |
| **AWS EC2 + Elastic IP** | 인스턴스·IPv4·디스크 합산, 대략 **US$8 이상** | Elastic IP를 EC2 인스턴스에 연결 | 높음 | AWS VPC, 보안 그룹, IAM, Linux, SSH, Node.js 운영, DNS·TLS, 비용 관리 | 서울 리전과 세밀한 인프라 구성이 장점이다. Lightsail보다 설정과 과금 구조가 복잡해 현재 규모에서는 선택 이유가 적다. 향후 VPC, 로드밸런서, 관리형 DB 등 AWS 구성이 커질 때 적합하다. |

## 추천 순서

1. **AWS Lightsail 1GB 플랜(월 US$7)**
   현재 규모에서 가격, 서울 리전, 고정 IPv4, 예측 가능한 과금의 균형이 가장 좋다. 정적 IP를 인스턴스에 연결하고 한 대에서 프론트엔드와 API 서버를 함께 운영하면 구성이 단순하다.

2. **Railway Pro(월 최소 US$20)**
   Linux 서버 운영을 피하고 Git push 중심으로 배포하려면 적합하다. 결제하기 전에 Railway가 보여 주는 모든 outbound IP를 키움에 등록할 수 있는지 확인해야 한다.

3. **DigitalOcean Droplet 1GB(월 US$6)**
   VPS 운영에 익숙하고 AWS를 사용하고 싶지 않을 때 좋은 대안이다. Reserved IP를 출발 IP로 사용하는 네트워크 설정을 정확히 적용하고 재부팅 후에도 유지되는지 검증해야 한다.

Render의 Dedicated IP는 설정은 편하지만 이 프로젝트에는 비용이 과하다. EC2는 Lightsail에서 제공하지 않는 AWS 네트워크 구성이 필요할 때 고려하는 편이 낫다.

## Lightsail을 선택할 때 필요한 배포 작업

1. 서울 리전에 Ubuntu 기반 Lightsail 인스턴스를 만들고 정적 IPv4를 연결한다.
2. SSH 키 로그인만 허용하고, 방화벽에서 `22`, `80`, `443` 포트를 필요한 범위로 제한한다.
3. Node.js LTS를 설치하고 운영용 서버 진입점으로 앱을 실행한다.
4. systemd 또는 PM2로 프로세스 재시작과 부팅 시 자동 실행을 설정한다.
5. Nginx 또는 Caddy에서 HTTPS를 종료하고 Node 서버로 전달한다.
6. 실투자 앱 키와 시크릿을 서버의 비밀 환경변수로 설정한다. `.env` 파일은 배포 산출물이나 Git에 포함하지 않는다.
7. 서버에서 외부 IPv4 확인 서비스를 호출해 출발 IP가 Lightsail 정적 IP와 같은지 검증한다.
8. 검증한 IPv4를 키움에 등록한 뒤, 조회 API로 연결을 먼저 확인한다. 실투자 주문은 별도 안전 절차를 거쳐 활성화한다.

## 선택 시 주의사항

- `고정 inbound IP`와 `고정 outbound IP`는 같은 기능이 아닐 수 있다. 키움 등록에는 키움으로 나가는 요청의 outbound IP가 중요하다.
- 서버리스·엣지 플랫폼은 기본 outbound IP가 공유되거나 변경될 수 있다. 별도 고정 egress 기능이 명시되지 않으면 사용하지 않는다.
- IP가 여러 개인 PaaS는 키움이 허용하는 등록 개수와 형식을 먼저 확인한다.
- VPS의 공인 IP가 오래 유지되더라도 서비스가 이를 명시적으로 정적 IP로 보장하는지 확인한다.
- 단일 VPS는 장애 지점이 하나다. 주문 서비스로 장기간 운영한다면 백업, 모니터링, 보안 업데이트, 장애 복구 절차가 필요하다.
- 운영 배포 전에 실투자 인증정보를 별도 환경변수로 설정하고, UI에서 선택한 국내·해외 및 실전·모의 환경을 다시 확인한다.

## 공식 자료

- [AWS Lightsail 가격](https://aws.amazon.com/lightsail/pricing/) — 공인 IPv4 포함 Linux 플랜 US$5/월부터
- [AWS Lightsail 정적 IP 설명](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-static-ip-addresses-in-amazon-lightsail.html)
- [AWS Lightsail 지원 리전](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-regions-and-availability-zones-in-amazon-lightsail.html) — 서울(`ap-northeast-2`) 포함
- [DigitalOcean Droplet 가격](https://www.digitalocean.com/pricing/droplets) — Basic 1GB US$6/월
- [DigitalOcean Reserved IP를 outbound에 사용하는 방법](https://docs.digitalocean.com/products/networking/reserved-ips/how-to/outbound-traffic/)
- [Railway 가격](https://railway.com/pricing) — Pro 월 최소 사용료 US$20
- [Railway Static Outbound IP 문서](https://docs.railway.com/networking/static-outbound-ips)
- [Render 가격](https://render.com/pricing) — Pro, 컴퓨트, Dedicated IP 과금
- [Render Dedicated IP 문서](https://render.com/docs/dedicated-ips)
- [Vite 정적 배포 안내](https://vite.dev/guide/static-deploy) — `vite preview`는 운영 서버 용도가 아님
