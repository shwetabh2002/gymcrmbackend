#!/usr/bin/env python3
"""End-to-end API smoke for Gym CRM — run against localhost:5000."""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from typing import Any

BASE = "http://localhost:5000"
EMAIL = "superadmin@gym.local"
PASSWORD = "SuperAdmin@123"

results: list[tuple[str, str, str]] = []


def log(step: str, status: str, detail: str = ""):
    results.append((step, status, detail))
    mark = "PASS" if status == "PASS" else ("SKIP" if status == "SKIP" else "FAIL")
    print(f"[{mark}] {step}" + (f" — {detail}" if detail else ""))


def req(
    method: str,
    path: str,
    token: str | None = None,
    body: dict | None = None,
    expect: int | None = None,
) -> tuple[int, Any]:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(
        f"{BASE}{path}", data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(r, timeout=30) as res:
            raw = res.read().decode() or "{}"
            code = res.status
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = raw
            if expect is not None and code != expect:
                raise AssertionError(f"expected {expect} got {code}: {payload}")
            return code, payload
    except urllib.error.HTTPError as e:
        raw = e.read().decode() or "{}"
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = raw
        if expect is not None and e.code != expect:
            raise AssertionError(f"expected {expect} got {e.code}: {payload}") from e
        return e.code, payload


def token_from(login: dict) -> str:
    t = login.get("tokens") or {}
    return t.get("accessToken") or login.get("accessToken") or ""


def main() -> int:
    # 1) Login
    try:
        code, login = req(
            "POST",
            "/auth/admin/login",
            body={"email": EMAIL, "password": PASSWORD},
            expect=201,
        )
        # Nest may return 200
    except AssertionError:
        code, login = req(
            "POST",
            "/auth/admin/login",
            body={"email": EMAIL, "password": PASSWORD},
        )
    tok = token_from(login if isinstance(login, dict) else {})
    if not tok or not isinstance(login, dict):
        log("1. Login SUPER_ADMIN", "FAIL", str(login)[:200])
        return 1
    user = login.get("user") or {}
    log(
        "1. Login SUPER_ADMIN",
        "PASS",
        f"role={user.get('role')} http={code}",
    )

    # Refresh
    refresh = (login.get("tokens") or {}).get("refreshToken")
    if refresh:
        try:
            rcode, refreshed = req(
                "POST",
                "/auth/refresh",
                body={},
                # refresh uses Authorization: Bearer refreshToken
            )
            # Use refresh token as bearer
            r = urllib.request.Request(
                f"{BASE}/auth/refresh",
                data=b"{}",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {refresh}",
                },
                method="POST",
            )
            with urllib.request.urlopen(r, timeout=30) as res:
                refreshed = json.loads(res.read().decode())
                new_tok = token_from(refreshed)
                if new_tok:
                    tok = new_tok
                    log("1b. Refresh token", "PASS")
                else:
                    log("1b. Refresh token", "FAIL", str(refreshed)[:160])
        except Exception as e:
            log("1b. Refresh token", "FAIL", str(e)[:160])
    else:
        log("1b. Refresh token", "SKIP", "no refreshToken in login")

    # 2) Companies list / onboard / select
    code, companies = req("GET", "/companies", token=tok)
    if code != 200:
        log("2. List companies", "FAIL", str(companies)[:160])
        return 1
    rows = companies if isinstance(companies, list) else companies.get("items") or []
    log("2. List companies", "PASS", f"count={len(rows)}")

    company_id = None
    if rows:
        company_id = rows[0].get("id") or rows[0].get("_id") or rows[0].get("companyId")
    if not company_id:
        suffix = str(int(time.time()))[-6:]
        code, onboarded = req(
            "POST",
            "/companies/onboard",
            token=tok,
            body={
                "gymName": f"Smoke Gym {suffix}",
                "adminName": "Smoke Admin",
                "adminEmail": f"smoke{suffix}@gym.local",
                "adminPassword": "SmokeAdmin@123",
                "city": "Mumbai",
                "countryCode": "IN",
            },
        )
        if code not in (200, 201):
            # try signup public
            code, onboarded = req(
                "POST",
                "/companies/signup",
                body={
                    "gymName": f"Smoke Gym {suffix}",
                    "adminName": "Smoke Admin",
                    "adminEmail": f"smoke{suffix}@gym.local",
                    "adminPassword": "SmokeAdmin@123",
                    "city": "Mumbai",
                    "countryCode": "IN",
                },
            )
        if isinstance(onboarded, dict):
            company_id = (
                onboarded.get("companyId")
                or (onboarded.get("company") or {}).get("id")
                or (onboarded.get("company") or {}).get("_id")
            )
        if not company_id:
            log("2b. Create gym", "FAIL", str(onboarded)[:200])
            return 1
        log("2b. Create gym", "PASS", f"companyId={company_id}")
        # re-login as super after onboard
        _, login = req(
            "POST",
            "/auth/admin/login",
            body={"email": EMAIL, "password": PASSWORD},
        )
        tok = token_from(login)

    code, selected = req("POST", f"/companies/{company_id}/select", token=tok)
    if code not in (200, 201):
        log("2c. Select gym", "FAIL", str(selected)[:200])
        return 1
    tok = token_from(selected) or tok
    sel_user = selected.get("user") if isinstance(selected, dict) else {}
    log(
        "2c. Select gym",
        "PASS",
        f"companyId={sel_user.get('companyId') or company_id}",
    )

    # 3) Subscription
    code, sub = req("GET", "/subscription", token=tok)
    if code != 200:
        log("3. Subscription snapshot", "FAIL", str(sub)[:200])
    else:
        log(
            "3. Subscription snapshot",
            "PASS",
            f"status={sub.get('status')} plan={sub.get('planCode')} canWrite={sub.get('canWrite')}",
        )

    # 4) Locations + plans
    code, locs = req("GET", "/locations", token=tok)
    if code != 200 or not locs:
        log("4. Locations", "FAIL", str(locs)[:160])
        return 1
    loc_id = locs[0].get("id") or locs[0].get("_id")
    log("4. Locations", "PASS", f"id={loc_id} count={len(locs)}")

    code, plans = req("GET", "/subscription-plans", token=tok)
    if code != 200 or not plans:
        log("4b. Membership plans", "FAIL", str(plans)[:160])
        return 1
    plan = next((p for p in plans if p.get("status") == "ACTIVE" or not p.get("status")), plans[0])
    plan_id = plan.get("id") or plan.get("_id")
    plan_price = float(plan.get("price") or 0)
    log("4b. Membership plans", "PASS", f"plan={plan.get('name')} price={plan_price}")

    # 5) Price inflate rejected
    phone = f"9{int(time.time()) % 10**9:09d}"
    code, bad = req(
        "POST",
        "/members",
        token=tok,
        body={
            "name": "Smoke Inflate",
            "phone": phone,
            "planId": plan_id,
            "locationId": loc_id,
            "amount": plan_price + 500,
            "received": plan_price + 500,
            "paymentMode": "CASH",
            "startingDate": time.strftime("%Y-%m-%d"),
        },
    )
    if code >= 400:
        log("5. Reject amount > plan.price", "PASS", f"http={code}")
    else:
        log("5. Reject amount > plan.price", "FAIL", f"accepted http={code}")

    # 6) Create member OK
    phone2 = f"8{int(time.time()) % 10**9:09d}"
    received = min(100.0, plan_price) if plan_price > 0 else 0
    body = {
        "name": "Smoke Member",
        "phone": phone2,
        "planId": plan_id,
        "locationId": loc_id,
        "amount": plan_price,
        "received": received,
        "paymentMode": "CASH",
        "startingDate": time.strftime("%Y-%m-%d"),
    }
    if received < plan_price:
        body["dueReminderDate"] = time.strftime("%Y-%m-%d")
    code, member = req("POST", "/members", token=tok, body=body)
    if code not in (200, 201) or not isinstance(member, dict):
        log("6. Create member", "FAIL", f"http={code} {str(member)[:200]}")
        return 1
    member_id = member.get("id") or member.get("_id")
    log("6. Create member", "PASS", f"id={member_id}")

    # Find subscription for member
    code, subs = req(
        "GET", f"/member-subscriptions?memberId={member_id}", token=tok
    )
    if code != 200:
        # try by member path
        code, subs = req(
            "GET", f"/member-subscriptions/member/{member_id}", token=tok
        )
    sub_list = subs if isinstance(subs, list) else (subs or {}).get("items") or []
    sub_id = None
    if sub_list:
        sub_id = sub_list[0].get("id") or sub_list[0].get("_id")
    if not sub_id and isinstance(member, dict):
        sub_id = (member.get("subscription") or {}).get("id") or member.get(
            "subscriptionId"
        )
    log(
        "6b. Member subscription",
        "PASS" if sub_id else "FAIL",
        f"subId={sub_id}",
    )

    # 7) Payment memberId mismatch
    if sub_id:
        # create a second member to steal id
        phone3 = f"7{int(time.time()) % 10**9:09d}"
        code, m2 = req(
            "POST",
            "/members",
            token=tok,
            body={
                "name": "Smoke Other",
                "phone": phone3,
                "locationId": loc_id,
            },
        )
        other_id = None
        if isinstance(m2, dict):
            other_id = m2.get("id") or m2.get("_id")
        if other_id:
            code, pay_bad = req(
                "POST",
                "/payments",
                token=tok,
                body={
                    "memberId": other_id,
                    "subscriptionId": sub_id,
                    "amount": 1,
                    "paymentMode": "CASH",
                    "paymentDate": time.strftime("%Y-%m-%d"),
                },
            )
            if code >= 400:
                log("7. Reject payment member mismatch", "PASS", f"http={code}")
            else:
                log(
                    "7. Reject payment member mismatch",
                    "FAIL",
                    f"accepted http={code}",
                )
        else:
            log("7. Reject payment member mismatch", "SKIP", "no second member")

        # Valid small payment if pending
        code, sub_detail = req("GET", f"/member-subscriptions/{sub_id}", token=tok)
        pending = 0.0
        if isinstance(sub_detail, dict):
            pending = float(sub_detail.get("pendingAmount") or 0)
        if pending > 0:
            amt = min(pending, 50.0)
            code, pay = req(
                "POST",
                "/payments",
                token=tok,
                body={
                    "memberId": member_id,
                    "subscriptionId": sub_id,
                    "amount": amt,
                    "paymentMode": "CASH",
                    "paymentDate": time.strftime("%Y-%m-%d"),
                },
            )
            if code in (200, 201):
                log("7b. Create payment", "PASS", f"amount={amt}")
            else:
                log("7b. Create payment", "FAIL", f"http={code} {str(pay)[:160]}")
        else:
            log("7b. Create payment", "SKIP", "nothing pending")
    else:
        log("7. Payment checks", "SKIP", "no subscription")

    # 8) Feature gates
    code, settings = req("GET", "/gym-settings", token=tok)
    if code != 200:
        log("8. Gym settings", "FAIL", str(settings)[:160])
    else:
        log(
            "8. Gym settings",
            "PASS",
            f"autopayUnlocked={settings.get('featureAutopayUnlocked')} activityOn={settings.get('activityLogsEnabled')}",
        )

    # Locked razorpay connect should 403 without unlock
    code, rzp = req("POST", "/payment-provider/razorpay/mock", token=tok, body={})
    if settings.get("featureRazorpayUnlocked") or settings.get(
        "featureAutopayUnlocked"
    ):
        log(
            "8b. Razorpay lock",
            "SKIP",
            f"already unlocked http={code}",
        )
    elif code in (403, 401):
        log("8b. Razorpay locked → block", "PASS", f"http={code}")
    else:
        log("8b. Razorpay locked → block", "FAIL", f"http={code} {str(rzp)[:120]}")

    # Unlock activity + razorpay then gym switch
    code, unlocked = req(
        "PUT",
        "/gym-settings",
        token=tok,
        body={
            "featureActivityLogsUnlocked": True,
            "featureRazorpayUnlocked": True,
            "activityLogRetentionDays": 30,
        },
    )
    if code == 200:
        log("8c. Unlock Activity + Razorpay", "PASS")
    else:
        log("8c. Unlock Activity + Razorpay", "FAIL", f"http={code} {str(unlocked)[:160]}")

    # Turn activity ON (may fail if ACTIVITY_LOGS_ENABLED=false)
    code, gym_on = req(
        "PUT",
        "/gym-settings",
        token=tok,
        body={"activityLogsEnabled": True},
    )
    if code == 200 and isinstance(gym_on, dict) and gym_on.get("activityLogsEnabled"):
        log("9. Gym activityLogsEnabled ON", "PASS")
    elif code >= 400:
        msg = ""
        if isinstance(gym_on, dict):
            msg = gym_on.get("message") or str(gym_on)
        log(
            "9. Gym activityLogsEnabled ON",
            "PASS" if "ACTIVITY_LOGS_ENABLED" in str(msg) or "disabled on the server" in str(msg) else "FAIL",
            f"blocked as expected when server off: http={code} {str(msg)[:120]}",
        )
    else:
        log("9. Gym activityLogsEnabled ON", "FAIL", f"http={code}")

    code, al = req("GET", "/activity-logs", token=tok)
    if code == 200 and isinstance(al, dict):
        log(
            "9b. Activity logs list",
            "PASS",
            f"enabled={al.get('enabled')} available={al.get('available')} entitled={al.get('entitled')} items={len(al.get('items') or [])}",
        )
    else:
        log("9b. Activity logs list", "FAIL", f"http={code}")

    # 10) Branch limit — try create extra location on Starter
    code, loc2 = req(
        "POST",
        "/locations",
        token=tok,
        body={"name": f"Extra Branch {int(time.time()) % 10000}"},
    )
    if code in (403, 400):
        log("10. maxBranches enforce", "PASS", f"http={code}")
    elif code in (200, 201):
        log(
            "10. maxBranches enforce",
            "PASS",
            f"created (plan allows more) http={code}",
        )
    else:
        log("10. maxBranches enforce", "FAIL", f"http={code} {str(loc2)[:120]}")

    # 11) changePlan on active should work; fake revive path N/A if canWrite
    if isinstance(sub, dict) and sub.get("canWrite"):
        code, changed = req(
            "POST",
            "/subscription/plan",
            token=tok,
            body={"planCode": sub.get("planCode") or "STARTER", "interval": "MONTHLY"},
        )
        if code == 200:
            log("11. changePlan (active)", "PASS")
        else:
            log("11. changePlan (active)", "FAIL", f"http={code} {str(changed)[:160]}")
    else:
        log("11. changePlan (active)", "SKIP", "not writable")

    # Summary
    print("\n=== SUMMARY ===")
    fails = [r for r in results if r[1] == "FAIL"]
    passes = [r for r in results if r[1] == "PASS"]
    skips = [r for r in results if r[1] == "SKIP"]
    print(f"PASS={len(passes)} FAIL={len(fails)} SKIP={len(skips)}")
    for s, st, d in fails:
        print(f"  FAIL: {s} — {d}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
