#!/bin/bash
#
# if-new.sh — create a new GCP/Firebase project and provision everything
# the template needs to deploy.
#
# Architecture:
#   - SECTION 1: HTTP server (Perl-backed loopback) — used only for OAuth.
#     Bash drives it via FIFOs + a synchronous request/response protocol.
#   - SECTION 2: Helpers (url coding, json, OAuth refresh, GCP/Firebase REST).
#   - SECTION 3: HTML templates (browser-side: OAuth + handoff pages).
#   - SECTION 4: Browser dispatcher — runs OAuth/picker, then hands off.
#   - SECTION 5: Terminal flow — project name + provisioning.
#
# Run via the public bootstrap (after install.sh has cloned this repo):
#   curl -fsSL https://almostawake.com/new.sh | bash
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/if-lib.sh"

# =====================================================================
# SECTION 1 — HTTP server (Perl-backed)
# =====================================================================

HTTP_LOG="${HTTP_LOG:-/tmp/if-new.log}"

http_log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" >> "$HTTP_LOG"
}

# Truncate a body for log readability — collapse newlines, cap length.
# Generous cap (1k) so we capture full Google error structures.
log_trunc() {
  printf '%s' "$1" | tr '\n' ' ' | cut -c1-1000
}

http_pick_port() {
  local p
  HTTP_PORT=0
  for p in 50421 51284 52103 53117 54209 55327 56419 57531 58647 59761; do
    if ! lsof -i :$p >/dev/null 2>&1; then
      HTTP_PORT=$p; return
    fi
  done
  die "no free port"
}

HTTP_PERL_SERVER='
use IO::Socket::INET;
$| = 1;
my $port = $ENV{PERL_PORT} or die "PERL_PORT not set";
my $sock = IO::Socket::INET->new(
    LocalAddr => "127.0.0.1", LocalPort => $port, Proto => "tcp",
    Listen => 5, ReuseAddr => 1,
) or die "bind failed on $port: $!";
print STDERR "listening on 127.0.0.1:$port\n";
while (my $client = $sock->accept) {
    $client->autoflush(1);
    my $req = "";
    while (sysread($client, my $buf, 4096)) {
        $req .= $buf;
        last if $req =~ /\r?\n\r?\n/;
    }
    next unless $req;
    my ($first) = split /\r?\n/, $req;
    my ($method, $path) = split / /, $first;
    $method //= "GET"; $path //= "/";
    print "$method\t$path\n";
    my $len_line = <STDIN>;
    last unless defined $len_line;
    chomp $len_line;
    my $body = "";
    if ($len_line =~ /^(\d+)$/) {
        my $n = $1; my $got = 0;
        while ($got < $n) {
            my $r = read(STDIN, my $buf, $n - $got);
            last unless $r;
            $body .= $buf; $got += $r;
        }
    }
    my $blen = length($body);
    print $client "HTTP/1.1 200 OK\r\n";
    print $client "Content-Type: text/html; charset=utf-8\r\n";
    print $client "Content-Length: $blen\r\n";
    print $client "Connection: close\r\n\r\n";
    print $client $body;
    close $client;
    print STDERR "served $method $path ($blen bytes)\n";
}
'

http_start() {
  : > "$HTTP_LOG"
  http_pick_port
  HTTP_IN=$(mktemp -u);  mkfifo "$HTTP_IN"
  HTTP_OUT=$(mktemp -u); mkfifo "$HTTP_OUT"
  exec 8<>"$HTTP_IN"
  exec 7<>"$HTTP_OUT"
  PERL_PORT="$HTTP_PORT" perl -e "$HTTP_PERL_SERVER" < "$HTTP_IN" > "$HTTP_OUT" 2>> "$HTTP_LOG" &
  HTTP_PID=$!
  http_log "server pid=$HTTP_PID port=$HTTP_PORT"
  sleep 0.3
}

http_recv() {
  IFS=$'\t' read -r REQ_METHOD REQ_PATH_QUERY <&7 || return 1
  REQ_PATH="${REQ_PATH_QUERY%%\?*}"
  if [[ "$REQ_PATH_QUERY" == *\?* ]]; then
    REQ_QUERY="${REQ_PATH_QUERY#*\?}"
  else
    REQ_QUERY=""
  fi
  http_log "recv $REQ_METHOD $REQ_PATH_QUERY"
}

http_send() {
  local body="$1"
  local bytes
  bytes=$(printf '%s' "$body" | wc -c | tr -d ' ')
  printf '%d\n' "$bytes" >&8
  printf '%s' "$body" >&8
  http_log "send $bytes bytes"
}

http_stop() {
  exec 7<&- 2>/dev/null || true
  exec 8>&- 2>/dev/null || true
  kill "$HTTP_PID" 2>/dev/null || true
  wait "$HTTP_PID" 2>/dev/null || true
  rm -f "$HTTP_IN" "$HTTP_OUT"
  http_log "server stopped"
}

# =====================================================================
# SECTION 2 — helpers
# =====================================================================

urlencode() {
  local s="$1" out="" c i
  for ((i=0; i<${#s}; i++)); do
    c="${s:$i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out+="$c" ;;
      ' ') out+='%20' ;;
      *) out+=$(printf '%%%02X' "'$c") ;;
    esac
  done
  printf '%s' "$out"
}

urldecode() {
  local s="${1//+/ }"
  printf '%b' "${s//%/\\x}"
}

json_extract() {
  grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]+\"" | head -1 \
    | sed -E "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\1/"
}

query_param() {
  printf '%s' "$1" | grep -oE "(^|&)$2=[^&]*" | head -1 | sed -E "s/^&?$2=//"
}

# Pull the operation `name` out of an LRO response body.
op_name_from() {
  printf '%s' "$1" | grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]+' \
    | head -1 | sed 's/.*"\([^"]*\)$/\1/'
}

# Populate the global EXISTING_PIDS array with active projects accessible
# to the authenticated account (via cloudresourcemanager projects:search).
# A personal account is well under the page limit, so a single page is fine.
EXISTING_PIDS=()
list_projects() {
  EXISTING_PIDS=()
  local resp
  if ! resp=$(curl -fsSL \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      "https://cloudresourcemanager.googleapis.com/v3/projects:search?query=state:ACTIVE&pageSize=50" 2>&1); then
    http_log "list_projects: failed: $resp"
    return 1
  fi

  local pids
  pids=$(printf '%s' "$resp" | perl -MJSON::PP -e '
    my $j = decode_json(do { local $/; <STDIN> });
    for my $p (@{$j->{projects} // []}) {
      print $p->{projectId}, "\n";
    }
  ') || { http_log "list_projects: parse failed"; return 1; }

  while IFS= read -r line; do
    [ -n "$line" ] && EXISTING_PIDS+=("$line")
  done <<< "$pids"
  http_log "list_projects: ${#EXISTING_PIDS[@]} active project(s) found"
  return 0
}

# Refresh the access_token in a cred file. POSTs to Google's token
# endpoint with grant_type=refresh_token, merges the response back into
# the file, and sets the global $ACCESS_TOKEN. Preserves the old
# refresh_token if Google's response didn't include a new one.
#
# Returns 0 on success, 1 on failure (caller falls back to OAuth).
refresh_access_token() {
  local cred_file="$1"
  local cid csec old_refresh email new_tokens new_access
  cid=$(json_extract client_id < "$cred_file")
  csec=$(json_extract client_secret < "$cred_file")
  old_refresh=$(json_extract refresh_token < "$cred_file")
  email=$(json_extract email < "$cred_file")
  { [ -z "$cid" ] || [ -z "$csec" ] || [ -z "$old_refresh" ]; } && return 1

  if ! new_tokens=$(curl -fsSL -X POST https://oauth2.googleapis.com/token \
      --data-urlencode "client_id=$cid" \
      --data-urlencode "client_secret=$csec" \
      --data-urlencode "refresh_token=$old_refresh" \
      --data-urlencode "grant_type=refresh_token" 2>&1); then
    http_log "refresh_access_token: curl failed for $email: $new_tokens"
    return 1
  fi

  new_access=$(printf '%s' "$new_tokens" | json_extract access_token)
  [ -z "$new_access" ] && { http_log "refresh_access_token: no access_token in response for $email"; return 1; }

  if ! NEW_TOKENS="$new_tokens" OLD_REFRESH="$old_refresh" \
       EMAIL_X="$email" CID="$cid" CSEC="$csec" \
       perl -MJSON::PP -e '
         my $tok = decode_json($ENV{NEW_TOKENS});
         $tok->{refresh_token} //= $ENV{OLD_REFRESH};
         my $out = {
           email         => $ENV{EMAIL_X},
           client_id     => $ENV{CID},
           client_secret => $ENV{CSEC},
           tokens        => $tok,
         };
         print JSON::PP->new->pretty->canonical->encode($out);
       ' > "$cred_file.tmp"; then
    rm -f "$cred_file.tmp"
    http_log "refresh_access_token: perl JSON merge failed for $email"
    return 1
  fi
  mv "$cred_file.tmp" "$cred_file"
  chmod 600 "$cred_file"

  ACCESS_TOKEN="$new_access"
  return 0
}

# Cheap pre-flight: do they have an OPEN billing account (free-trial or paid)?
# Sets PREFLIGHT_REASON on failure ("no_billing" | "billing_check_failed").
# Firebase ToS is detected later when add_firebase fails — there's no clean
# read-only probe for it.
PREFLIGHT_REASON=""
preflight_check() {
  PREFLIGHT_REASON=""
  local resp
  if ! resp=$(curl -fsSL -H "Authorization: Bearer $ACCESS_TOKEN" \
      "https://cloudbilling.googleapis.com/v1/billingAccounts" 2>&1); then
    PREFLIGHT_REASON="billing_check_failed"
    http_log "preflight: billing list failed: $resp"
    return 1
  fi
  if ! printf '%s' "$resp" | grep -q '"open"[[:space:]]*:[[:space:]]*true'; then
    PREFLIGHT_REASON="no_billing"
    http_log "preflight: no open billing account"
    return 1
  fi
  return 0
}

# Wait for a Google long-running operation. $1 = full op URL, $2 = timeout sec.
# Caller can set X_GOOG_USER_PROJECT to add the X-Goog-User-Project header
# (required for Firebase/Identity APIs once they're enabled on the project).
wait_for_op() {
  local url="$1" timeout="${2:-60}"
  local i resp code hdr=()
  if [ -n "${X_GOOG_USER_PROJECT:-}" ]; then
    hdr=(-H "X-Goog-User-Project: $X_GOOG_USER_PROJECT")
  fi
  http_log "wait_for_op start: $url (timeout=${timeout}s, X-Goog-User-Project=${X_GOOG_USER_PROJECT:-<none>})"
  for i in $(seq 1 "$timeout"); do
    # Capture body and HTTP code separately so silent 4xx/5xx don't read as "still pending".
    local tmp; tmp=$(mktemp)
    code=$(curl -s -o "$tmp" -w "%{http_code}" \
      -H "Authorization: Bearer $ACCESS_TOKEN" "${hdr[@]}" "$url")
    resp=$(cat "$tmp"); rm -f "$tmp"
    http_log "  poll #$i HTTP $code: $(log_trunc "$resp")"
    if [ "$code" != "200" ]; then
      http_log "wait_for_op aborting: non-200 status from poll"
      return 1
    fi
    if printf '%s' "$resp" | grep -q '"done"[[:space:]]*:[[:space:]]*true'; then
      if printf '%s' "$resp" | grep -q '"error"'; then
        http_log "wait_for_op error from $url"
        return 1
      fi
      http_log "wait_for_op done after $i polls"
      return 0
    fi
    sleep 1
  done
  http_log "wait_for_op timeout after ${timeout}s: $url last_resp: $(log_trunc "$resp")"
  return 1
}

# Create a GCP project and wait for the long-running op. Prints one of:
#   ok | taken | timeout | err<code>
create_project() {
  local pid="$1"
  local tmp; tmp=$(mktemp)
  local code
  code=$(curl -s -o "$tmp" -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"projectId\":\"$pid\",\"displayName\":\"$pid\"}" \
    "https://cloudresourcemanager.googleapis.com/v3/projects")
  local body; body=$(cat "$tmp"); rm -f "$tmp"
  http_log "create_project $pid → HTTP $code"

  if [ "$code" = "409" ] || printf '%s' "$body" | grep -qi 'already.*exists\|ALREADY_EXISTS'; then
    printf '%s' "taken"; return
  fi
  if [ "$code" != "200" ] && [ "$code" != "201" ]; then
    printf 'err%s' "$code"; return
  fi

  local op_name; op_name=$(op_name_from "$body")
  [ -z "$op_name" ] && { printf '%s' "err-noop"; return; }

  local i resp
  for i in $(seq 1 60); do
    sleep 1
    resp=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
      "https://cloudresourcemanager.googleapis.com/v3/$op_name")
    if printf '%s' "$resp" | grep -q '"done"[[:space:]]*:[[:space:]]*true'; then
      if printf '%s' "$resp" | grep -q '"error"'; then
        if printf '%s' "$resp" | grep -qi 'already.*exists\|ALREADY_EXISTS'; then
          printf '%s' "taken"; return
        fi
        printf '%s' "err-op-failed"; return
      fi
      printf '%s' "ok"; return
    fi
  done
  printf '%s' "timeout"
}

# Enable a single API. first=1 skips X-Goog-User-Project (chicken-and-egg
# on a fresh project that has no APIs to bill quota to yet).
enable_api() {
  local pid="$1" api="$2" first="${3:-0}"
  local hdr=(-H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json")
  [ "$first" != "1" ] && hdr+=(-H "X-Goog-User-Project: $pid")

  http_log "enable_api start: pid=$pid api=$api first=$first"
  local tmp; tmp=$(mktemp)
  local code
  code=$(curl -s -o "$tmp" -w "%{http_code}" -X POST "${hdr[@]}" \
    "https://serviceusage.googleapis.com/v1/projects/$pid/services/$api:enable")
  local body; body=$(cat "$tmp"); rm -f "$tmp"
  http_log "enable_api $api → HTTP $code body: $(log_trunc "$body")"

  if [ "$code" != "200" ]; then
    return 1
  fi
  # Already-enabled services return operations/noop.DONE_OPERATION with
  # done:true right in the response body — that's NOT a real op, polling
  # it 400s with "Invalid operation id". Treat done:true as success.
  if printf '%s' "$body" | grep -q '"done"[[:space:]]*:[[:space:]]*true'; then
    http_log "enable_api $api: completed synchronously (already enabled)"
    return 0
  fi
  local op_name; op_name=$(op_name_from "$body")
  http_log "enable_api $api op_name='$op_name'"
  if [ -n "$op_name" ]; then
    # Chicken-and-egg: on a fresh project, X-Goog-User-Project on the LRO
    # poll silently 403s. Drop the header for first-enable polls.
    if [ "$first" = "1" ]; then
      wait_for_op "https://serviceusage.googleapis.com/v1/$op_name" 120
    else
      X_GOOG_USER_PROJECT="$pid" wait_for_op "https://serviceusage.googleapis.com/v1/$op_name" 120
    fi
  else
    http_log "enable_api $api: no op_name; treating POST 200 as success"
  fi
}

# Link an open billing account to a project. preflight_check has already
# verified that the user has at least one open billing account; this step
# attaches the first open account to the project so billing-required APIs
# (Cloud Build / Run / Artifact Registry / etc) can be enabled. Idempotent.
link_billing() {
  local pid="$1"
  http_log "link_billing start: pid=$pid"

  local cur_resp
  cur_resp=$(curl -s \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    "https://cloudbilling.googleapis.com/v1/projects/$pid/billingInfo")
  http_log "link_billing $pid current: $(log_trunc "$cur_resp")"
  if printf '%s' "$cur_resp" | grep -q '"billingEnabled"[[:space:]]*:[[:space:]]*true'; then
    http_log "link_billing $pid: already linked, skipping"
    return 0
  fi

  local accounts_resp
  accounts_resp=$(curl -s \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    "https://cloudbilling.googleapis.com/v1/billingAccounts")
  http_log "link_billing $pid accounts: $(log_trunc "$accounts_resp")"
  local account_name
  account_name=$(ACCOUNTS="$accounts_resp" perl -MJSON::PP -e '
    my $j = decode_json($ENV{ACCOUNTS});
    for my $a (@{$j->{billingAccounts} // []}) {
      if ($a->{open}) { print $a->{name}; last; }
    }
  ')
  if [ -z "$account_name" ]; then
    http_log "link_billing $pid: no open billing account found"
    return 1
  fi
  http_log "link_billing $pid: linking $account_name"

  local tmp; tmp=$(mktemp)
  local code
  code=$(curl -s -o "$tmp" -w "%{http_code}" -X PUT \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"billingAccountName\":\"$account_name\"}" \
    "https://cloudbilling.googleapis.com/v1/projects/$pid/billingInfo")
  local body; body=$(cat "$tmp"); rm -f "$tmp"
  http_log "link_billing $pid PUT → HTTP $code body: $(log_trunc "$body")"
  if [ "$code" != "200" ]; then
    return 1
  fi
}

# Convert a GCP project to a Firebase project. Sets PREFLIGHT_REASON to
# "no_firebase_tos" if the call fails because the user hasn't accepted
# the Firebase ToS yet (structured 400 response).
add_firebase() {
  local pid="$1"

  http_log "add_firebase start: pid=$pid"
  # Already a Firebase project? Skip. (Idempotency: a GET on the project
  # returns 200 once it's been added to Firebase, 404 otherwise.)
  local check_tmp; check_tmp=$(mktemp)
  local check_code
  check_code=$(curl -s -o "$check_tmp" -w "%{http_code}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "X-Goog-User-Project: $pid" \
    "https://firebase.googleapis.com/v1beta1/projects/$pid")
  local check_body; check_body=$(cat "$check_tmp"); rm -f "$check_tmp"
  http_log "add_firebase $pid skip-check → HTTP $check_code body: $(log_trunc "$check_body")"
  if [ "$check_code" = "200" ]; then
    http_log "add_firebase $pid: already Firebase, skipping"
    return 0
  fi

  local tmp; tmp=$(mktemp)
  local code
  code=$(curl -s -o "$tmp" -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "X-Goog-User-Project: $pid" \
    -H "Content-Type: application/json" \
    -d '{}' \
    "https://firebase.googleapis.com/v1beta1/projects/$pid:addFirebase")
  local body; body=$(cat "$tmp"); rm -f "$tmp"
  http_log "add_firebase $pid → HTTP $code body: $(log_trunc "$body")"

  if [ "$code" = "400" ] && printf '%s' "$body" | grep -qi 'terms.of.service\|console\.developers\.google\.com/terms'; then
    PREFLIGHT_REASON="no_firebase_tos"
    return 1
  fi
  if [ "$code" != "200" ]; then
    return 1
  fi
  local op_name; op_name=$(op_name_from "$body")
  http_log "add_firebase $pid op_name='$op_name'"
  [ -z "$op_name" ] && return 1
  X_GOOG_USER_PROJECT="$pid" wait_for_op "https://firebase.googleapis.com/v1beta1/$op_name" 120
}

# Create a Firebase web app config so the SvelteKit client can call
# initializeApp({...}). The resulting webApp's apiKey/appId are fetched
# later (when the template is set up) via webApps.list + webApps.getConfig.
create_web_app() {
  local pid="$1"

  http_log "create_web_app start: pid=$pid"
  # Already has a web app? Skip. (List returns {"apps":[...]} when any exist.)
  local list_resp
  list_resp=$(curl -s \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "X-Goog-User-Project: $pid" \
    "https://firebase.googleapis.com/v1beta1/projects/$pid/webApps")
  http_log "create_web_app $pid skip-check list: $(log_trunc "$list_resp")"
  if printf '%s' "$list_resp" | grep -q '"appId"'; then
    http_log "create_web_app $pid: web app exists, skipping"
    return 0
  fi

  local tmp; tmp=$(mktemp)
  local code
  code=$(curl -s -o "$tmp" -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "X-Goog-User-Project: $pid" \
    -H "Content-Type: application/json" \
    -d '{"displayName":"web"}' \
    "https://firebase.googleapis.com/v1beta1/projects/$pid/webApps")
  local body; body=$(cat "$tmp"); rm -f "$tmp"
  http_log "create_web_app $pid → HTTP $code body: $(log_trunc "$body")"
  if [ "$code" != "200" ]; then
    return 1
  fi
  local op_name; op_name=$(op_name_from "$body")
  http_log "create_web_app $pid op_name='$op_name'"
  [ -z "$op_name" ] && return 1
  X_GOOG_USER_PROJECT="$pid" wait_for_op "https://firebase.googleapis.com/v1beta1/$op_name" 120
}

# Create the (default) Firestore database in australia-southeast1, NATIVE mode.
create_firestore() {
  local pid="$1"

  http_log "create_firestore start: pid=$pid"
  # Default database already exists? Skip. (GET returns 200 if so, 404 otherwise.)
  local check_tmp; check_tmp=$(mktemp)
  local check_code
  check_code=$(curl -s -o "$check_tmp" -w "%{http_code}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "X-Goog-User-Project: $pid" \
    "https://firestore.googleapis.com/v1/projects/$pid/databases/(default)")
  local check_body; check_body=$(cat "$check_tmp"); rm -f "$check_tmp"
  http_log "create_firestore $pid skip-check → HTTP $check_code body: $(log_trunc "$check_body")"
  if [ "$check_code" = "200" ]; then
    http_log "create_firestore $pid: (default) exists, skipping"
    return 0
  fi

  local tmp; tmp=$(mktemp)
  local code
  code=$(curl -s -o "$tmp" -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "X-Goog-User-Project: $pid" \
    -H "Content-Type: application/json" \
    -d '{"locationId":"australia-southeast1","type":"FIRESTORE_NATIVE"}' \
    "https://firestore.googleapis.com/v1/projects/$pid/databases?databaseId=(default)")
  local body; body=$(cat "$tmp"); rm -f "$tmp"
  http_log "create_firestore $pid → HTTP $code body: $(log_trunc "$body")"
  if [ "$code" != "200" ]; then
    return 1
  fi
  local op_name; op_name=$(op_name_from "$body")
  http_log "create_firestore $pid op_name='$op_name'"
  [ -z "$op_name" ] && return 1
  X_GOOG_USER_PROJECT="$pid" wait_for_op "https://firestore.googleapis.com/v1/$op_name" 180
}

# Create the default Firebase Storage bucket in australia-southeast1.
create_storage_bucket() {
  local pid="$1"

  http_log "create_storage_bucket start: pid=$pid"
  # Default bucket already exists? Skip. (List returns a non-empty buckets[]
  # array when any are linked to this project.)
  local list_resp
  list_resp=$(curl -s \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "X-Goog-User-Project: $pid" \
    "https://firebasestorage.googleapis.com/v1beta/projects/$pid/buckets")
  http_log "create_storage_bucket $pid skip-check list: $(log_trunc "$list_resp")"
  if printf '%s' "$list_resp" | grep -q '"bucket"'; then
    http_log "create_storage_bucket $pid: bucket exists, skipping"
    return 0
  fi

  local tmp; tmp=$(mktemp)
  local code
  code=$(curl -s -o "$tmp" -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "X-Goog-User-Project: $pid" \
    -H "Content-Type: application/json" \
    -d '{"location":"australia-southeast1"}' \
    "https://firebasestorage.googleapis.com/v1beta/projects/$pid/defaultBucket")
  local body; body=$(cat "$tmp"); rm -f "$tmp"
  http_log "create_storage_bucket $pid → HTTP $code body: $(log_trunc "$body")"
  if [ "$code" != "200" ]; then
    return 1
  fi
  # Some endpoints return an LRO; poll only if a real op name came back.
  local op_name; op_name=$(op_name_from "$body")
  http_log "create_storage_bucket $pid op_name='$op_name'"
  if [ -n "$op_name" ] && [[ "$op_name" == *operations/* ]]; then
    X_GOOG_USER_PROJECT="$pid" wait_for_op "https://firebasestorage.googleapis.com/v1beta/$op_name" 120
  fi
}

# Configure email-link sign-in via Identity Toolkit. Reads the existing
# authorizedDomains list and appends "localhost" so the link works in
# local dev (projects created after 2025-04-28 don't include it by default).
configure_email_link_auth() {
  local pid="$1"
  http_log "configure_email_link_auth start: pid=$pid"

  # The Identity Toolkit Config resource doesn't exist until the first PATCH —
  # so GET can return 404 even on a project where the API is enabled.
  # Inspect the code rather than -fsSL'ing out on 404.
  local cur_tmp; cur_tmp=$(mktemp)
  local cur cur_code
  cur_code=$(curl -s -o "$cur_tmp" -w "%{http_code}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "X-Goog-User-Project: $pid" \
    "https://identitytoolkit.googleapis.com/admin/v2/projects/$pid/config")
  cur=$(cat "$cur_tmp"); rm -f "$cur_tmp"
  http_log "configure_email_link_auth $pid GET → HTTP $cur_code body: $(log_trunc "$cur")"

  # If config doesn't exist (fresh project), initializeAuth creates it.
  # PATCH alone won't — it returns CONFIGURATION_NOT_FOUND. initializeAuth
  # bootstraps the project on Identity Platform (free tier: 50K MAU/month),
  # which is more than enough for personal-automation use. Email-link sign-in
  # works the same as on plain Firebase Auth.
  if [ "$cur_code" = "404" ]; then
    http_log "configure_email_link_auth $pid: initializing Identity Platform"
    local init_tmp; init_tmp=$(mktemp)
    local init_code init_body
    init_code=$(curl -s -o "$init_tmp" -w "%{http_code}" -X POST \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H "X-Goog-User-Project: $pid" \
      -H "Content-Type: application/json" \
      -d '{}' \
      "https://identitytoolkit.googleapis.com/v2/projects/$pid/identityPlatform:initializeAuth")
    init_body=$(cat "$init_tmp"); rm -f "$init_tmp"
    http_log "configure_email_link_auth $pid initializeAuth → HTTP $init_code body: $(log_trunc "$init_body")"
    if [ "$init_code" != "200" ]; then
      return 1
    fi

    # Re-GET to read the now-existing config (we want its default authorizedDomains).
    cur_tmp=$(mktemp)
    cur_code=$(curl -s -o "$cur_tmp" -w "%{http_code}" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H "X-Goog-User-Project: $pid" \
      "https://identitytoolkit.googleapis.com/admin/v2/projects/$pid/config")
    cur=$(cat "$cur_tmp"); rm -f "$cur_tmp"
    http_log "configure_email_link_auth $pid GET (post-init) → HTTP $cur_code body: $(log_trunc "$cur")"
    if [ "$cur_code" != "200" ]; then
      return 1
    fi
  elif [ "$cur_code" != "200" ]; then
    http_log "configure_email_link_auth: unexpected GET status $cur_code"
    return 1
  fi

  # Append localhost to the existing authorizedDomains (which now exists
  # whether the config was already there or was just created by initializeAuth).
  local domains_json
  domains_json=$(CUR="$cur" perl -MJSON::PP -e '
    my $j = decode_json($ENV{CUR});
    my @d = @{$j->{authorizedDomains} // []};
    push @d, "localhost" unless grep { $_ eq "localhost" } @d;
    print encode_json(\@d);
  ') || { http_log "configure_email_link_auth: domain merge failed"; return 1; }

  local body
  body=$(printf '{"signIn":{"email":{"enabled":true,"passwordRequired":false}},"authorizedDomains":%s}' "$domains_json")

  local tmp; tmp=$(mktemp)
  local code
  code=$(curl -s -o "$tmp" -w "%{http_code}" -X PATCH \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "X-Goog-User-Project: $pid" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "https://identitytoolkit.googleapis.com/admin/v2/projects/$pid/config?updateMask=signIn.email,authorizedDomains")
  local resp; resp=$(cat "$tmp"); rm -f "$tmp"
  http_log "configure_email_link_auth $pid → HTTP $code body: $(log_trunc "$resp")"
  if [ "$code" != "200" ]; then
    return 1
  fi
}

# Validate a GCP project ID. Collects ALL violated rules into the
# VALIDATION_ERRORS array — mirrors the browser form's multi-error display
# (the user sees every rule they're breaking at once, not just the first).
VALIDATION_ERRORS=()
validate_gcp_project_id() {
  local id="$1"
  VALIDATION_ERRORS=()
  if [ -z "$id" ]; then
    VALIDATION_ERRORS+=("cannot be empty")
    return 1
  fi
  if [ "${#id}" -lt 6 ];            then VALIDATION_ERRORS+=("6 char min"); fi
  if [ "${#id}" -gt 30 ];           then VALIDATION_ERRORS+=("30 char max"); fi
  if [[ ! "$id" =~ ^[a-z] ]];       then VALIDATION_ERRORS+=("must start with a letter"); fi
  if [[ "$id" =~ -- ]];             then VALIDATION_ERRORS+=("no double dashes"); fi
  if [[ "$id" =~ -$ ]];             then VALIDATION_ERRORS+=("cannot end with a dash"); fi
  if [[ ! "$id" =~ ^[a-z0-9-]+$ ]]; then VALIDATION_ERRORS+=("lowercase letters, digits, dashes only"); fi
  if [ ${#VALIDATION_ERRORS[@]} -gt 0 ]; then return 1; fi
  return 0
}

# Print the terminal equivalent of build_setup_needed_html.
print_setup_needed_terminal() {
  local email="$1" reason="$2"
  echo ""
  case "$reason" in
    no_firebase_tos)
      echo "  ✗ Firebase Terms of Service not accepted yet for $email."
      echo ""
      echo "    Fastest fix: open Firebase Console and start their"
      echo "    'create a project' flow once. It bundles ToS acceptance."
      echo ""
      echo "    https://console.firebase.google.com/"
      ;;
    no_billing)
      echo "  ✗ No billing account set up yet for $email."
      echo ""
      echo "    Fastest fix: open Firebase Console, click Create a project,"
      echo "    accept the free trial when prompted."
      echo ""
      echo "    https://console.firebase.google.com/"
      ;;
    *)
      echo "  ✗ Setup issue for $email: $reason"
      ;;
  esac
  echo ""
  echo "  Then re-run this script."
  echo ""
}

# Provisioning items, paired in lockstep with PROV_FNS — same shape as
# if-install.sh's ITEMS / INSTALL_FNS so the row-update mechanism is
# identical (○ pending → ⋯ running → ✓ done, in place).
#
# Three label arrays mirror state-appropriate phrasing:
#   pending  "enable firebase api"        (infinitive — "to do")
#   running  "enabling firebase api"      (gerund — "doing")
#   done     "firebase api enabled"       (past — "done", reads like "X created")
PROV_PENDING=(
  "enable firebase api"
  "add firebase to project"
  "link billing account"
  "enable eventarc api"
  "enable firestore api"
  "enable cloud storage api"
  "enable firebase storage api"
  "enable identity toolkit api"
  "enable firebase hosting api"
  "enable cloud functions api"
  "enable cloud build api"
  "enable cloud run api"
  "enable artifact registry api"
  "enable cloud pub/sub api"
  "enable cloud scheduler api"
  "enable gemini api"
  "enable api keys api"
  "create web app config"
  "create firestore (sydney)"
  "create storage bucket (sydney)"
  "configure email-link auth"
)
PROV_RUNNING=(
  "enabling firebase api"
  "adding firebase to project"
  "linking billing account"
  "enabling eventarc api"
  "enabling firestore api"
  "enabling cloud storage api"
  "enabling firebase storage api"
  "enabling identity toolkit api"
  "enabling firebase hosting api"
  "enabling cloud functions api"
  "enabling cloud build api"
  "enabling cloud run api"
  "enabling artifact registry api"
  "enabling cloud pub/sub api"
  "enabling cloud scheduler api"
  "enabling gemini api"
  "enabling api keys api"
  "creating web app config"
  "creating firestore (sydney)"
  "creating storage bucket (sydney)"
  "configuring email-link auth"
)
PROV_DONE=(
  "firebase api enabled"
  "firebase added to project"
  "billing account linked"
  "eventarc api enabled"
  "firestore api enabled"
  "cloud storage api enabled"
  "firebase storage api enabled"
  "identity toolkit api enabled"
  "firebase hosting api enabled"
  "cloud functions api enabled"
  "cloud build api enabled"
  "cloud run api enabled"
  "artifact registry api enabled"
  "cloud pub/sub api enabled"
  "cloud scheduler api enabled"
  "gemini api enabled"
  "api keys api enabled"
  "web app config created"
  "firestore (sydney) created"
  "storage bucket (sydney) created"
  "email-link auth configured"
)
PROV_FNS=(
  "_prov_enable_firebase"
  "_prov_add_firebase"
  "_prov_link_billing"
  "_prov_enable_eventarc"
  "_prov_enable_firestore"
  "_prov_enable_storage"
  "_prov_enable_firebasestorage"
  "_prov_enable_identitytoolkit"
  "_prov_enable_firebasehosting"
  "_prov_enable_cloudfunctions"
  "_prov_enable_cloudbuild"
  "_prov_enable_run"
  "_prov_enable_artifactregistry"
  "_prov_enable_pubsub"
  "_prov_enable_cloudscheduler"
  "_prov_enable_gemini"
  "_prov_enable_apikeys"
  "_prov_web_app"
  "_prov_firestore"
  "_prov_storage"
  "_prov_auth"
)
PROV_N=${#PROV_PENDING[@]}

# Wrappers — global $PID is set by the terminal flow before provisioning.
_prov_enable_firebase()         { enable_api "$PID" firebase.googleapis.com 1; }
_prov_add_firebase()            { add_firebase "$PID"; }
_prov_link_billing()            { link_billing "$PID"; }
_prov_enable_firestore()        { enable_api "$PID" firestore.googleapis.com; }
_prov_enable_storage()          { enable_api "$PID" storage.googleapis.com; }
_prov_enable_firebasestorage()  { enable_api "$PID" firebasestorage.googleapis.com; }
_prov_enable_identitytoolkit()  { enable_api "$PID" identitytoolkit.googleapis.com; }
_prov_enable_firebasehosting()  { enable_api "$PID" firebasehosting.googleapis.com; }
_prov_enable_cloudfunctions()   { enable_api "$PID" cloudfunctions.googleapis.com; }
_prov_enable_cloudbuild()       { enable_api "$PID" cloudbuild.googleapis.com; }
_prov_enable_run()              { enable_api "$PID" run.googleapis.com; }
_prov_enable_artifactregistry() { enable_api "$PID" artifactregistry.googleapis.com; }
_prov_enable_eventarc()         { enable_api "$PID" eventarc.googleapis.com; }
_prov_enable_pubsub()            { enable_api "$PID" pubsub.googleapis.com; }
_prov_enable_cloudscheduler()   { enable_api "$PID" cloudscheduler.googleapis.com; }
_prov_enable_gemini()           { enable_api "$PID" generativelanguage.googleapis.com; }
_prov_enable_apikeys()          { enable_api "$PID" apikeys.googleapis.com; }
_prov_web_app()                 { create_web_app "$PID"; }
_prov_firestore()               { create_firestore "$PID"; }
_prov_storage()                 { create_storage_bucket "$PID"; }
_prov_auth()                    { configure_email_link_auth "$PID"; }

# draw_prov_row "$i" "$state"  — state: done | running | pending | failed
draw_prov_row() {
  local i="$1" state="$2"
  local icon color label
  case "$state" in
    done)    icon="${C_GRN}✓${C_RST}";  color="$C_GRN";  label="${PROV_DONE[$i]}"    ;;
    running) icon="${C_GRAY}⋯${C_RST}"; color="$C_GRAY"; label="${PROV_RUNNING[$i]}" ;;
    pending) icon="${C_GRAY}○${C_RST}"; color="$C_GRAY"; label="${PROV_PENDING[$i]}" ;;
    failed)  icon="${C_RED}✗${C_RST}";  color="$C_RED";  label="${PROV_RUNNING[$i]}" ;;
  esac
  printf '  %b  %b%s%b\n' "$icon" "$color" "$label" "$C_RST"
}

# update_prov_row — move cursor up to row i, redraw, return cursor.
# Assumes cursor is on the line just below the last row.
update_prov_row() {
  local i="$1" state="$2"
  local up=$((PROV_N - i))
  printf '\033[%dA\r\033[K' "$up"
  draw_prov_row "$i" "$state"
  local down=$((PROV_N - i - 1))
  if [ "$down" -gt 0 ]; then
    printf '\033[%dB\r' "$down"
  fi
}

# Provisioning orchestrator. Renders all rows pending, runs each step
# in order, animating the row in place. On failure, marks the row red,
# prints a hint if it's a known cause, and returns 1.
provision_all() {
  local i fn rc

  for i in $(seq 0 $((PROV_N - 1))); do
    draw_prov_row "$i" "pending"
  done

  for i in "${!PROV_FNS[@]}"; do
    fn="${PROV_FNS[$i]}"
    update_prov_row "$i" "running"
    rc=0
    "$fn" || rc=$?
    if [ "$rc" -eq 0 ]; then
      update_prov_row "$i" "done"
    else
      update_prov_row "$i" "failed"
      echo ""
      if [ "$PREFLIGHT_REASON" = "no_firebase_tos" ]; then
        print_setup_needed_terminal "$EMAIL" "no_firebase_tos"
      fi
      return 1
    fi
  done
  return 0
}

# =====================================================================
# SECTION 3 — HTML templates
# =====================================================================

build_explainer_html() {
  local auth_url="$1"
  cat <<HTML
<!doctype html><html><head><meta charset="utf-8"><title>Sign in to Google</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:560px;margin:3em auto;padding:0 1.5em;color:#333;line-height:1.55}
 h1{font-size:1.4em;margin-bottom:.4em}
 h2{font-size:.82em;margin-top:1.8em;margin-bottom:.3em;color:#555;letter-spacing:.04em;text-transform:uppercase}
 ul{list-style:none;padding:0;margin:.3em 0}
 li{padding:.3em 0}
 .ok{color:#0a7}.no{color:#b33}
 .actions{margin-top:2em;display:flex;gap:.75em;align-items:center}
 a.btn{padding:.55em 1.1em;border-radius:6px;text-decoration:none;font-weight:500;display:inline-block}
 a.primary{background:#1a73e8;color:#fff}
 a.secondary{color:#666}
 p.small{color:#888;font-size:.9em;margin-top:1.8em}
 a{color:#1a73e8}
</style></head><body>
<h1>Sign in to Google</h1>
<p>The next page will ask you to sign in and approve the following:</p>
<h2>Will be requested</h2>
<ul>
  <li class="ok">✓ See which Google account is yours (email + profile)</li>
  <li class="ok">✓ Manage Google Cloud resources on your behalf<br><small style="color:#777">(create projects, enable APIs, deploy services — everything the template needs to set up and run your app)</small></li>
</ul>
<h2>Will NOT be requested</h2>
<ul>
  <li class="no">✗ Gmail, Drive, Calendar, Sheets, or any personal data</li>
  <li class="no">✗ Access to other Google accounts</li>
  <li class="no">✗ Any third-party services</li>
</ul>
<p class="small">
You can revoke access any time at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
</p>
<div class="actions" id="actions">
  <a class="btn primary" href="$auth_url">Continue</a>
  <a class="btn secondary" href="#" id="cancel">Cancel</a>
</div>
<div id="cancelled" style="display:none">
  <h1>No worries, we hope to see you back soon!</h1>
  <p class="small">Feel free to close this browser tab now.</p>
</div>
<script>
document.getElementById('cancel').addEventListener('click', function(e){
  e.preventDefault();
  fetch('/?cancelled=1').catch(function(){});
  document.querySelector('body').innerHTML = document.getElementById('cancelled').innerHTML;
});
</script>
</body></html>
HTML
}

build_pick_html() {
  local items_html="" i
  for i in "${!existing_emails[@]}"; do
    items_html+="  <li><a class=\"pick\" href=\"/?pick=$i\">${existing_emails[$i]}</a></li>"$'\n'
  done
  items_html+='  <li><a class="pick new" href="/?pick=new">+ new account</a></li>'
  cat <<HTML
<!doctype html><html><head><meta charset="utf-8"><title>Which account?</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:560px;margin:3em auto;padding:0 1.5em;color:#333;line-height:1.55}
 h1{font-size:1.4em;margin-bottom:.4em}
 p{color:#555}
 ul.picker{list-style:none;padding:0;margin:1.2em 0}
 ul.picker li{margin:.4em 0}
 a.pick{display:block;padding:.7em 1em;border:1px solid #ddd;border-radius:6px;color:#333;text-decoration:none}
 a.pick:hover{border-color:#1a73e8;background:#f0f6ff}
 a.pick.new{color:#1a73e8;border-style:dashed}
</style></head><body>
<h1>Which account?</h1>
<p>We'll use this account to create a new project. Which would you like to use?</p>
<ul class="picker">
$items_html
</ul>
</body></html>
HTML
}

build_browser_done_html() {
  local email="$1"
  cat <<HTML
<!doctype html><html><head><meta charset="utf-8"><title>Signed in</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:560px;margin:3em auto;padding:0 1.5em;color:#333;line-height:1.55}
 h1{font-size:1.4em;margin-bottom:.4em;color:#0a7}
 p.small{color:#888;font-size:.9em;margin-top:1.8em}
</style></head><body>
<h1>✓ Signed in</h1>
<p>Signed in as <b>$email</b>. Return to your terminal — we'll continue setup there.</p>
<p class="small">You can close this tab.</p>
</body></html>
HTML
}

build_setup_needed_html() {
  local email="$1" reason="$2"
  local what
  case "$reason" in
    no_billing)
      what="It looks like <b>$email</b> doesn't have a Google Cloud billing account set up yet."
      ;;
    no_firebase_tos)
      what="It looks like <b>$email</b> hasn't accepted the Firebase terms of service yet."
      ;;
    *)
      what="Something's missing from <b>$email</b>'s Google Cloud setup."
      ;;
  esac
  cat <<HTML
<!doctype html><html><head><meta charset="utf-8"><title>One more setup step</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:560px;margin:3em auto;padding:0 1.5em;color:#333;line-height:1.55}
 h1{font-size:1.4em;margin-bottom:.4em}
 a.btn{display:inline-block;padding:.6em 1.2em;border-radius:6px;background:#1a73e8;color:#fff;text-decoration:none;font-weight:500;margin:1em 0}
 ol{padding-left:1.2em}
 li{margin:.45em 0}
 code{font-family:ui-monospace,monospace;background:#f4f4f4;padding:.1em .35em;border-radius:3px}
 p.small{color:#888;font-size:.9em;margin-top:1.8em}
</style></head><body>
<h1>One more setup step</h1>
<p>$what</p>
<p>The fastest fix: open the Firebase Console and run their "create a project" flow once. It walks you through Google's free-trial credits AND the Firebase terms — both gates, one flow.</p>
<a class="btn" href="https://console.firebase.google.com/" target="_blank">Open Firebase Console</a>
<ol>
  <li>Click <b>Create a project</b> (or <b>Add project</b>) if it isn't already open.</li>
  <li>Use <code>nothing</code> as the project name. We won't use this project — it's just to get the gates accepted.</li>
  <li>When asked to upgrade to Blaze / accept free-trial credits, accept.</li>
  <li>Once the project finishes creating, come back to your terminal and re-run <code>if-new.sh</code>.</li>
</ol>
<p class="small">You can close this tab.</p>
</body></html>
HTML
}

build_fatal_html() {
  local msg="$1"
  cat <<HTML
<!doctype html><html><head><meta charset="utf-8"><title>Error</title>
<style>body{font-family:system-ui;padding:3em;max-width:36em;margin:auto;color:#333;line-height:1.55}pre{background:#f4f4f4;padding:1em;border-radius:6px;overflow:auto}</style>
</head><body>
<h2 style="color:#b33">✗ $msg</h2>
<p>Check /tmp/if-new.log for details. You can close this tab.</p>
</body></html>
HTML
}

# =====================================================================
# SECTION 4 — Browser dispatcher
# =====================================================================

CLIENT_ID="32555940559.apps.googleusercontent.com"
CLIENT_SECRET="ZmssLNjJy2998hD4CTg2ejr2"
# `firebase` scope alongside cloud-platform: firebase-tools does a literal-
# string scope check, so without it firebase-tools considers our token
# invalid and tries to refresh through its own OAuth client (which fails).
SCOPE="openid email https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase"

ACCESS_TOKEN=""
EMAIL=""
existing_creds=()
existing_emails=()
CREDS_DIR="$HOME/.if/creds"
if [ -d "$CREDS_DIR" ]; then
  for cred_file in "$CREDS_DIR"/*.json; do
    [ -f "$cred_file" ] || continue
    existing_creds+=("$cred_file")
    existing_emails+=("$(json_extract email < "$cred_file")")
  done
fi

if [ ${#existing_creds[@]} -gt 0 ]; then
  initial_state="pick_account"
else
  initial_state="waiting_auth"
fi

if ! prompt_yn "Ready to set up your Google cloud project?" "Y"; then
  exit 0
fi
echo ""
echo "Sign in to Google Cloud using the account you set up during install..."

http_start
trap http_stop EXIT

REDIRECT_URI="http://127.0.0.1:$HTTP_PORT"
SCOPE_ENC=$(urlencode "$SCOPE")
REDIRECT_ENC=$(urlencode "$REDIRECT_URI")
AUTH_URL="https://accounts.google.com/o/oauth2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_ENC}&response_type=code&scope=${SCOPE_ENC}&access_type=offline&prompt=consent"

EXPLAINER_HTML=$(build_explainer_html "$AUTH_URL")

open "http://127.0.0.1:$HTTP_PORT/"

state="$initial_state"

while http_recv; do
  if [ "$REQ_PATH" != "/" ]; then
    http_send ""
    continue
  fi

  case "$state" in

    pick_account)
      if [[ "$REQ_QUERY" == *pick=* ]]; then
        picked=$(query_param "$REQ_QUERY" pick)
        if [ "$picked" = "new" ]; then
          http_send "$EXPLAINER_HTML"
          state="waiting_auth"
        else
          selected="${existing_creds[$picked]}"
          EMAIL=$(json_extract email < "$selected")
          if [ -z "$EMAIL" ]; then
            http_send "$(build_fatal_html "Couldn't read email from $selected")"
            break
          fi
          if refresh_access_token "$selected"; then
            if preflight_check; then
              http_send "$(build_browser_done_html "$EMAIL")"
              break
            else
              http_send "$(build_setup_needed_html "$EMAIL" "$PREFLIGHT_REASON")"
              break
            fi
          else
            http_send "$EXPLAINER_HTML"
            state="waiting_auth"
          fi
        fi
      else
        http_send "$(build_pick_html)"
      fi
      ;;

    waiting_auth)
      if [[ "$REQ_QUERY" == *cancelled=1* ]]; then
        http_send ""
        break
      elif [[ "$REQ_QUERY" == *error=* ]]; then
        err=$(query_param "$REQ_QUERY" error)
        http_send "$(build_fatal_html "OAuth error: $err")"
        http_log "OAuth error: $err"
        break
      elif [[ "$REQ_QUERY" == *code=* ]]; then
        CODE_RAW=$(query_param "$REQ_QUERY" code)
        CODE=$(urldecode "$CODE_RAW")

        if ! TOKENS=$(curl -fsSL -X POST https://oauth2.googleapis.com/token \
            --data-urlencode "client_id=$CLIENT_ID" \
            --data-urlencode "client_secret=$CLIENT_SECRET" \
            --data-urlencode "code=$CODE" \
            --data-urlencode "redirect_uri=$REDIRECT_URI" \
            --data-urlencode "grant_type=authorization_code" 2>&1); then
          http_send "$(build_fatal_html "Token exchange failed")"
          http_log "token exchange failed: $TOKENS"
          break
        fi
        ACCESS_TOKEN=$(printf '%s' "$TOKENS" | json_extract access_token)
        if [ -z "$ACCESS_TOKEN" ]; then
          http_send "$(build_fatal_html "No access token in response")"
          break
        fi

        USERINFO=$(curl -fsSL -H "Authorization: Bearer $ACCESS_TOKEN" \
          https://www.googleapis.com/oauth2/v3/userinfo 2>&1) || true
        EMAIL=$(printf '%s' "$USERINFO" | json_extract email)
        [ -z "$EMAIL" ] && EMAIL="unknown"

        mkdir -p ~/.if/creds
        chmod 700 ~/.if ~/.if/creds
        CRED_PATH="$HOME/.if/creds/${EMAIL}.json"
        cat > "$CRED_PATH" <<JSON
{
  "email": "$EMAIL",
  "client_id": "$CLIENT_ID",
  "client_secret": "$CLIENT_SECRET",
  "tokens": $TOKENS
}
JSON
        chmod 600 "$CRED_PATH"

        if preflight_check; then
          http_send "$(build_browser_done_html "$EMAIL")"
          break
        else
          http_send "$(build_setup_needed_html "$EMAIL" "$PREFLIGHT_REASON")"
          break
        fi
      else
        http_send "$EXPLAINER_HTML"
      fi
      ;;

  esac
done

http_stop
trap - EXIT

# Sign-in didn't complete (cancelled, fatal error, etc).
if [ -z "$ACCESS_TOKEN" ] || [ -z "$EMAIL" ]; then
  echo ""
  echo "  Sign-in didn't complete. Re-run when ready."
  echo ""
  exit 1
fi

# Preflight failed in the browser flow (no_billing). Browser already
# showed the instructions; mirror them in terminal and exit.
if [ -n "$PREFLIGHT_REASON" ]; then
  print_setup_needed_terminal "$EMAIL" "$PREFLIGHT_REASON"
  exit 1
fi

# =====================================================================
# SECTION 5 — Terminal flow
# =====================================================================

echo ""
echo "Signed in as $EMAIL."
echo ""

# Prompts the user to pick a new GCP project id, validates with the same
# rules the browser form used, and creates it. Sets the global PID on
# success; loops on validation errors, ALREADY_EXISTS, etc.
prompt_create_project() {
  PID=""
  local tried_names=() candidate result joined e
  while [ -z "$PID" ]; do
    if [ ${#tried_names[@]} -gt 0 ]; then
      joined=$(printf "%s, " "${tried_names[@]}")
      joined="${joined%, }"
      printf "  ${C_GRAY}already tried: %s${C_RST}\n" "$joined"
    fi
    printf "  project id: "
    read -r candidate </dev/tty || candidate=""
    if ! validate_gcp_project_id "$candidate"; then
      for e in "${VALIDATION_ERRORS[@]}"; do
        printf "  ${C_RED}✗  %s${C_RST}\n" "$e"
      done
      echo ""
      continue
    fi
    printf "  ${C_GRAY}⋯  creating %s${C_RST}" "$candidate"
    result=$(create_project "$candidate")
    printf "\r\033[K"
    case "$result" in
      ok)
        printf "  ${C_GRN}✓  %s created${C_RST}\n" "$candidate"
        PID="$candidate"
        ;;
      taken)
        printf "  ${C_RED}✗  %s is taken${C_RST}\n\n" "$candidate"
        tried_names+=("$candidate")
        ;;
      timeout)
        printf "  ${C_RED}✗  create timed out for %s${C_RST}\n\n" "$candidate"
        tried_names+=("$candidate")
        ;;
      err*)
        printf "  ${C_RED}✗  error creating %s (HTTP %s)${C_RST}\n\n" "$candidate" "${result#err}"
        tried_names+=("$candidate")
        ;;
      *)
        printf "  ${C_RED}✗  unexpected result (%s) for %s${C_RST}\n\n" "$result" "$candidate"
        tried_names+=("$candidate")
        ;;
    esac
  done
}

# Pull existing projects so we can offer reuse alongside "create a new one".
# Encouraged because (a) every Firebase-ToS-accepting user already has a
# leftover "nothing-XXXXX" shell and (b) tests of provisioning logic
# shouldn't need a fresh project each time.
list_projects || true

PID=""
if [ ${#EXISTING_PIDS[@]} -eq 0 ]; then
  prompt_create_project
else
  while [ -z "$PID" ]; do
    echo "Pick a project to provision:"
    echo ""
    n=1
    for p in "${EXISTING_PIDS[@]}"; do
      printf "  %d. %s\n" "$n" "$p"
      n=$((n + 1))
    done
    printf "  %d. + create a new project\n" "$n"
    echo ""
    printf "  > "
    read -r choice </dev/tty || choice=""

    if [[ ! "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "$n" ]; then
      printf "  ${C_RED}✗  pick a number 1-%d${C_RST}\n\n" "$n"
      continue
    fi

    if [ "$choice" -eq "$n" ]; then
      echo ""
      prompt_create_project
    else
      PID="${EXISTING_PIDS[$((choice - 1))]}"
      echo ""
      printf "  ${C_GRN}✓  using %s${C_RST}\n" "$PID"
    fi
  done
fi

if ! provision_all; then
  echo "  ✗ provisioning didn't complete. See /tmp/if-new.log for details."
  echo ""
  exit 1
fi

echo ""
echo "  Project: $PID"
echo "  Console: https://console.firebase.google.com/project/$PID"
echo ""
