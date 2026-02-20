#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

PROJECT_NAME="${PROJECT_NAME:-kakao-auth}"
LOG_ROOT="${LOG_ROOT:-.omx/team-ops/$PROJECT_NAME}"
mkdir -p "$LOG_ROOT"

# 팀/역할별 결과를 기록할 파일
TEAM_MAP_FILE="$LOG_ROOT/teams.txt"
WATCH_INTERVAL="${WATCH_INTERVAL:-30}"
SUMMARY_FILE="$LOG_ROOT/final-summary-$(date +%Y%m%d_%H%M%S).md"

function require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[ERROR] '$1' command is not installed." >&2
    exit 1
  }
}

function preflight() {
  echo "=== Preflight ==="
  require tmux
  require omx

  if [[ -z "${TMUX:-}" ]]; then
    echo "[ERROR] TMUX session required. Run this script inside a tmux pane." >&2
    exit 1
  fi

  if [[ ! -d .omx ]]; then
    mkdir -p .omx
  fi

  if [[ ! -d .omx/state ]]; then
    mkdir -p .omx/state
  fi

  echo "TMUX=$TMUX"
  echo "OMX=$(command -v omx)"
  echo "Project: $PROJECT_ROOT"
}

function next_log_file() {
  local role="$1"
  echo "$LOG_ROOT/${role}-$(date +"%Y%m%d_%H%M%S").log"
}

function write_handoff_template() {
  local role="$1"
  local out="$LOG_ROOT/handoff-${role}.md"

  cat > "$out" <<EOF2
# 카카오 로그인 연동 인수인계
## 팀 정보
- 팀명: <팀명>
- 시작일/종료일: <YYYY-MM-DD HH:MM>
- 작업 상태: completed / partial / blocked

## 목표
- [목표 1]
- [목표 2]

## 산출물
- 파일:
  - path1
  - path2
- 로그/스크린샷:
  - <경로>

## 핵심 결정사항
- [결정 이유 + 대안 + 선택 이유]

## 완료 항목 (체크)
- [ ] 항목 1
- [ ] 항목 2
- [ ] 항목 3

## 발견 이슈
- Medium: ...
- Low: ...

## 다음 팀 전달사항
- Architect가 반드시 확인할 항목:
- Executor가 반드시 반영할 항목:
- Verifier가 점검할 항목:

## 검증 결과
- 자동 검증: npm run lint / npm run build / 수동 시나리오
- 수동 검증:
  - 로그인 성공:
  - 실패 케이스:
  - 토큰/세션:

## 위험/주의
- [ ] 운영 위험 1
- [ ] 운영 위험 2

## 최종 코멘트
- 승인/수정요청 + 다음 액션
EOF2
}

function get_team_status_text() {
  local team="$1"
  if ! status="$(omx team status "$team" 2>&1)"; then
    status="(team status command failed: $status)"
  fi
  printf "%s\n" "$status"
}

function finalize_team_records() {
  local role="$1"
  local team="$2"
  local now="$3"
  local handoff="$LOG_ROOT/handoff-${role}.md"
  local status_block="$4"

  local completed_marker="[ ]"
  if [[ "$status_block" == *"in_progress=0"* && "$status_block" == *"pending=0"* ]]; then
    completed_marker="[x]"
  elif [[ "$status_block" == *"completed" && "$status_block" != *"in_progress=1"* && "$status_block" != *"pending=1"* ]]; then
    completed_marker="[x]"
  fi

  cat >> "$handoff" <<EOF2

## 자동 완료 기록
- 기록 시각: ${now}
- 팀명: ${team}
- 상태: 종료 요청 처리 대상

### 팀 상태 스냅샷
\`\`\`
${status_block}
\`\`\`

### 완료 체크리스트
- ${completed_marker} 팀 종료/최종 정산 준비 완료 판정
- [ ] 팀 산출물/로그 검수 완료
- [ ] 다음 역할 이전 인수인계 반영 완료
EOF2
}

function generate_final_summary() {
  local now="$1"
  local header_written=0

  if [[ ! -f "$TEAM_MAP_FILE" ]]; then
    echo "[WARN] team map not found. skip summary."
    return 1
  fi

  : > "$SUMMARY_FILE"
  cat >> "$SUMMARY_FILE" <<EOF2
# 카카오 로그인 연동 팀 작업 최종 요약

프로젝트: ${PROJECT_NAME}
요약 시각: ${now}
로그 경로: ${LOG_ROOT}

## 팀 목록
EOF2

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local role="${line%%:*}"
    local team="${line#*: }"
    if [[ "$team" == "FAILED" || "$team" == *FAILED* ]]; then
      echo "- ${role}: ${team}" >> "$SUMMARY_FILE"
      continue
    fi
    header_written=1
    local status_block
    status_block="$(get_team_status_text "$team")"
    echo "- ${role}: ${team}" >> "$SUMMARY_FILE"
    echo "" >> "$SUMMARY_FILE"
    echo '```' >> "$SUMMARY_FILE"
    echo "$status_block" >> "$SUMMARY_FILE"
    echo '```' >> "$SUMMARY_FILE"
    echo >> "$SUMMARY_FILE"
    finalize_team_records "$role" "$team" "$now" "$status_block"
  done < "$TEAM_MAP_FILE"

  if [[ "$header_written" -eq 0 ]]; then
    echo "(No active team entry)." >> "$SUMMARY_FILE"
  fi

  if [[ -f "$TEAM_MAP_FILE" ]]; then
    echo "## 팀맵" >> "$SUMMARY_FILE"
    cat "$TEAM_MAP_FILE" >> "$SUMMARY_FILE"
  fi

  echo "" >> "$SUMMARY_FILE"
  echo "### 인수인계 템플릿(기본 경로)" >> "$SUMMARY_FILE"
  for f in "$LOG_ROOT"/handoff-*.md; do
    [[ -e "$f" ]] && echo "- ${f}" >> "$SUMMARY_FILE"
  done

  echo "Final summary generated: $SUMMARY_FILE"
}

function start_one_team() {
  local role="$1"
  local worker_type="$2"
  local task_desc="$3"

  local team_label="${PROJECT_NAME}-${role}"
  local prompt="[${team_label}] ${task_desc}"
  local log_file
  log_file="$(next_log_file "$role")"

  write_handoff_template "$role"

  echo "\n=== Starting ${role} (${worker_type}) ==="
  echo "Log: $log_file"

  local before=( $(ls -1 .omx/state/team 2>/dev/null | sort) )
  local output

  # runner with fallback for critic type
  if ! output=$(omx team "${worker_type}" "${prompt}" 2>&1 | tee "$log_file"); then
    if [[ "$role" == "critic" ]]; then
      echo "[WARN] critic role not available or failed, retrying as planner (critic 대체)."
      worker_type="1:planner"
      if ! output=$(omx team "${worker_type}" "${prompt} (critic 역할 대체 실행)" 2>&1 | tee -a "$log_file"); then
        echo "[ERROR] Team startup failed for ${role}." >&2
        echo "$output" >&2
        echo "$role: FAILED" >> "$TEAM_MAP_FILE.tmp"
        return 1
      fi
    else
      echo "[ERROR] Team startup failed for ${role}." >&2
      echo "$output" >&2
      echo "$role: FAILED" >> "$TEAM_MAP_FILE.tmp"
      return 1
    fi
  fi

  echo "$output" >> "$log_file"
  local team_name
  mapfile -t after < <(ls -1 .omx/state/team 2>/dev/null | sort)

  for t in "${after[@]}"; do
    local found=false
    for b in "${before[@]}"; do
      if [[ "$t" == "$b" ]]; then
        found=true
        break
      fi
    done
    if ! $found; then
      team_name="$t"
      break
    fi
  done

  if [[ -z "${team_name:-}" ]]; then
    team_name="$(ls -1t .omx/state/team 2>/dev/null | head -n 1 || true)"
  fi

  echo "${role}: ${team_name}" >> "$TEAM_MAP_FILE.tmp"
  echo "Team detected: ${team_name}"
  echo "${role}: ${team_name}"
}

function summary() {
  load_teams
  echo
  echo "=== Team map (${TEAM_MAP_FILE}) ==="
  cat "$TEAM_MAP_FILE"
  echo
  echo "Handoff templates:"
  for f in "$LOG_ROOT"/handoff-*.md; do
    [[ -e "$f" ]] && echo " - $f"
  done
}

function start_all() {
  : > "$TEAM_MAP_FILE.tmp"
  start_one_team "planner" "1:planner" "Planner 임무: 카카오 로그인 연동 요구사항 정리(성공/실패 시나리오 10개, env 및 DB 영향 분석 포함)"
  start_one_team "architect" "1:architect" "Architect 임무: 카카오 로그인 Supabase OAuth 아키텍처 설계 및 보안/세션 정책 확정"
  start_one_team "executor" "ralph" "Executor 임무: 카카오 간편가입/로그인 연동 코드 구현 및 최소 동작 상태 달성"
  start_one_team "verifier" "1:ultraqa" "Verifier 임무: 기능/보안/운영 중심으로 검증, PASS/FAIL 증거 수집"
  start_one_team "critic" "1:critic" "Critic 임무: 보안/운영 리스크 리뷰 및 go-live 판단"

  mv "$TEAM_MAP_FILE.tmp" "$TEAM_MAP_FILE"
  echo "\n=== Team summary ==="
  cat "$TEAM_MAP_FILE"
}

function load_teams() {
  if [[ ! -f "$TEAM_MAP_FILE" ]]; then
    echo "[ERROR] team map file not found: $TEAM_MAP_FILE"
    echo "Run: $0 start"
    exit 1
  fi
}

function status_all() {
  load_teams
  echo "=== 팀 상태 조회 ==="
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local role="${line%%:*}"
    local team="${line#*: }"
    if [[ "$team" == "FAILED" || "$team" == *FAILED* ]]; then
      continue
    fi
    echo "[$role] $team"
    omx team status "$team" || true
  done < "$TEAM_MAP_FILE"
}

function resume_all() {
  load_teams
  echo "=== 팀 재접속 ==="
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local team="${line#*: }"
    if [[ "$team" == "FAILED" || "$team" == *FAILED* ]]; then
      continue
    fi
    echo "[resume] $team"
    omx team resume "$team" || true
  done < "$TEAM_MAP_FILE"
}

function shutdown_all() {
  local now
  now=$(date '+%Y-%m-%d %H:%M:%S')
  generate_final_summary "$now" || true

  load_teams
  echo "=== 팀 종료 ==="
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local team="${line#*: }"
    if [[ "$team" == "FAILED" || "$team" == *FAILED* ]]; then
      continue
    fi
    echo "[shutdown] $team"
    omx team shutdown "$team" || true
  done < "$TEAM_MAP_FILE"

  echo
  echo "All shutdown commands sent. Summary: $SUMMARY_FILE"
  echo "If you need to keep the report only, run: ./scripts/kakao-auth-team.sh summary"
}

function watch_all() {
  load_teams
  while true; do
    clear
    now=$(date '+%Y-%m-%d %H:%M:%S')
    echo "=== Team watch: $now ==="
    status_all
    echo
    echo "Press Ctrl+C to stop watching."
    sleep "$WATCH_INTERVAL"
  done
}

function usage() {
  cat <<EOF2
Usage:
  ./scripts/kakao-auth-team.sh start      # 팀 생성(Planner/Architect/Executor/Verifier/Critic)
  ./scripts/kakao-auth-team.sh status     # 저장된 팀 상태 일괄 조회
  ./scripts/kakao-auth-team.sh resume     # 팀에 다시 붙기
  ./scripts/kakao-auth-team.sh shutdown   # 모든 팀 종료
  ./scripts/kakao-auth-team.sh summary    # 팀맵 + 인수인계 템플릿 경로 출력
  ./scripts/kakao-auth-team.sh run        # start + 즉시 status 한 번
  ./scripts/kakao-auth-team.sh watch      # 상태 감시 (Ctrl+C로 종료)
  ./scripts/kakao-auth-team.sh oneclick    # start + 상태 지속 감시 (Ctrl+C로 종료)
  ./scripts/kakao-auth-team.sh summarize   # 현재 팀맵 기준 최종 요약 강제 생성

Env:
  PROJECT_NAME (기본: kakao-auth)  : 팀 접두사
  LOG_ROOT    (기본: .omx/team-ops/<PROJECT_NAME>) : 로그 및 팀맵 저장 경로
  WATCH_INTERVAL (기본: 30) : watch 간격(초)
EOF2
}

cmd="${1:-}"
case "$cmd" in
  start)
    preflight
    start_all
    ;;
  run)
    preflight
    start_all
    status_all
    echo
    echo "[next] When finished:"
   echo "  ./scripts/kakao-auth-team.sh status"
  echo "  ./scripts/kakao-auth-team.sh watch"
  echo "  ./scripts/kakao-auth-team.sh shutdown"
  ;;
  oneclick)
    preflight
    start_all
    watch_all
    ;;
  status)
    status_all
    ;;
  resume)
    resume_all
    ;;
  shutdown)
    shutdown_all
    ;;
  summarize)
    generate_final_summary "$(date '+%Y-%m-%d %H:%M:%S')"
    ;;
  summary)
    summary
    ;;
  watch)
    watch_all
    ;;
  "")
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
