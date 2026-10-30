"""
Browser end-to-end test (Playwright, Python) for the whole flow: registration, Reddit submission, manual
verification, admin approval, eligibility, task applications, rewards, wallet, audit log, on a 390px phone
and a desktop viewport.

Run it against a FRESH database (it creates users and tasks, so a second run on the same data will fail):

  npm run build
  rm -rf .data && npm run db:seed-dev > .seed.txt            # test admin + test data; prints random passwords
  ALLOW_EMBEDDED_DB=true EMAIL_VERIFICATION_REQUIRED=false APP_URL=http://localhost:3100 npm start -- -p 3100
  pip install playwright && playwright install chromium
  python3 e2e/e2e.py

Environment: E2E_BASE_URL (default http://localhost:3100), E2E_SEED_FILE (default .seed.txt, the output of
`npm run db:seed-dev`) or E2E_ADMIN_PASSWORD, E2E_SHOTS_DIR (default e2e/shots).
"""
import os, re, sys, datetime, json
from playwright.sync_api import sync_playwright, expect

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get("E2E_BASE_URL", "http://localhost:3100").rstrip("/")
SHOTS = os.environ.get("E2E_SHOTS_DIR", os.path.join(HERE, "shots"))
os.makedirs(SHOTS, exist_ok=True)
ADMIN_EMAIL = "test-admin@example.test"
ADMIN_PW = os.environ.get("E2E_ADMIN_PASSWORD")
if not ADMIN_PW:
    seed_file = os.environ.get("E2E_SEED_FILE", os.path.join(HERE, "..", ".seed.txt"))
    try:
        ADMIN_PW = re.search(r"test-admin@example.test\s+password: (\S+)", open(seed_file).read()).group(1)
    except (OSError, AttributeError):
        sys.exit("Set E2E_ADMIN_PASSWORD, or E2E_SEED_FILE to the saved output of `npm run db:seed-dev`.")
PW = "correct horse battery"
results = []
console_errors = []

def check(name, fn):
    try:
        fn()
        results.append((name, True, ""))
        print(f"PASS  {name}")
    except Exception as e:
        import traceback
        tb = [l for l in traceback.format_exc().splitlines() if "e2e.py" in l]
        msg = (str(e).split("\n")[0][:200]) + "  @" + (tb[-1].strip().split(",")[1].strip() if tb else "?")
        results.append((name, False, msg))
        print(f"FAIL  {name}: {msg}")

def no_overflow(page):
    w = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    assert w[0] <= w[1] + 1, f"horizontal overflow {w}"

def shot(page, name, full=True):
    page.screenshot(path=os.path.join(SHOTS, f"{name}.png"), full_page=full)

with sync_playwright() as p:
    browser = p.chromium.launch()
    mobile = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    desk = browser.new_context(viewport={"width": 1280, "height": 860})
    for ctx in (mobile, desk):
        ctx.on("page", lambda pg: (pg.on("console", lambda m: console_errors.append((pg.url, m.text)) if m.type == "error" else None),
                                   pg.on("pageerror", lambda e: console_errors.append((pg.url, str(e))))))
    u = mobile.new_page()
    a = desk.new_page()

    # ---------------------------------------------------------------- public pages (mobile)
    for path, nm in [("/", "01-landing"), ("/signup", "02-signup"), ("/login", "03-login"), ("/help", "04-help"), ("/privacy", "05-privacy"), ("/forgot-password", "06-forgot")]:
        def f(path=path, nm=nm):
            r = u.goto(BASE + path); assert r.status == 200, r.status
            u.wait_for_timeout(1700 if path == "/" else 200)
            no_overflow(u); shot(u, nm)
        check(f"public page {path} renders on 390px without overflow", f)

    check("landing shows configured minimums (3 months / 100 / 100)", lambda: (
        expect(u.goto(BASE + "/") and u.get_by_text("At least 3 months").first).to_be_visible(),
        expect(u.get_by_text("At least 100").first).to_be_visible()))

    # ---------------------------------------------------------------- access control (no session)
    def f():
        for path, dest in [("/dashboard", "/login"), ("/wallet", "/login"), ("/tasks", "/login"), ("/admin", "/admin/login"), ("/admin/users", "/admin/login"), ("/admin/wallet", "/admin/login")]:
            c = browser.new_context(); pg = c.new_page(); pg.goto(BASE + path)
            assert pg.url.startswith(BASE + dest), f"{path} -> {pg.url}"; c.close()
    check("signed-out visitors are redirected away from user and admin pages", f)

    # ---------------------------------------------------------------- sign up
    def f():
        u.goto(BASE + "/signup")
        u.get_by_label("Email address").fill("e2e@example.test")
        u.get_by_label("Username").fill("e2e_user")
        u.get_by_label("Password", exact=True).fill("short")
        u.get_by_label("Confirm password").fill("short")
        u.get_by_role("button", name="Create account").click()
        expect(u.get_by_text("Please check the highlighted fields")).to_be_visible()
        expect(u.get_by_text("Use at least 10 characters")).to_be_visible()
        expect(u.get_by_label("Email address")).to_have_value("e2e@example.test")  # input preserved
        shot(u, "07-signup-errors")
    check("sign-up shows field errors and keeps what was typed", f)

    def f():
        u.get_by_label("Password", exact=True).fill(PW)
        u.get_by_label("Confirm password").fill(PW)
        u.get_by_label(re.compile("I agree")).check()
        u.get_by_role("button", name="Create account").click()
        u.wait_for_url(re.compile("/dashboard"))
    check("a new user can register and lands on the dashboard", f)

    def f():
        expect(u.get_by_text("Hi, e2e_user")).to_be_visible()
        expect(u.get_by_role("link", name="Submit Reddit account")).to_be_visible()
        expect(u.get_by_text("₹0.00")).to_be_visible()
        expect(u.get_by_text("Apply for More Tasks")).to_have_count(0)  # not approved yet
        no_overflow(u); shot(u, "08-dashboard-new")
    check("dashboard (new user): Submit button, ₹0.00 wallet, no task access", f)

    # ---------------------------------------------------------------- pending users cannot see tasks
    def f():
        u.goto(BASE + "/tasks"); expect(u.get_by_text("Tasks unlock after approval")).to_be_visible()
        u.goto(BASE + "/eligibility"); expect(u.get_by_text("Available after approval")).to_be_visible()
        u.goto(BASE + "/wallet"); expect(u.get_by_text("This wallet is a record, not a bank")).to_be_visible()
    check("unsubmitted user sees no task data; wallet notice present", f)

    # ---------------------------------------------------------------- submit reddit account
    def f():
        u.goto(BASE + "/application/submit")
        expect(u.get_by_text("At least 3 months")).to_be_visible()
        expect(u.get_by_text("Manual verification")).to_be_visible()  # Reddit API not configured
        u.get_by_label("Reddit profile link").fill("https://example.com/user/someone")
        expect(u.get_by_text("Only reddit.com profile links are accepted")).to_be_visible()
        u.get_by_label("Reddit profile link").fill("old.reddit.com/u/E2E_Redditor?x=1")
        expect(u.get_by_text("u/E2E_Redditor").first).to_be_visible()
        shot(u, "09-submit-preview")
    check("submit form: invalid link rejected live; valid link normalised live", f)

    def f():
        u.get_by_label("Reddit profile link").fill("https://example.com/user/someone")
        u.get_by_role("button", name="Submit for review").click()
        expect(u.get_by_text("Only reddit.com profile links are accepted").first).to_be_visible()
        assert "/application/submit" in u.url
    check("server also rejects an unrelated website", f)

    def f():
        u.get_by_label("Reddit profile link").fill("https://www.reddit.com/user/E2E_Redditor/")
        u.get_by_role("button", name="Submit for review").click()
        u.wait_for_url(re.compile("/application"))
        expect(u.get_by_text("Waiting for administrator review")).to_be_visible()
        expect(u.get_by_text("Manual Review Required").first).to_be_visible()
        expect(u.get_by_text("Not verified").first).to_be_visible() if u.get_by_text("Not verified").count() else None
        no_overflow(u); shot(u, "10-application-pending")
    check("valid submission → Pending Admin Review, flagged Manual Review Required, not 'Verified'", f)

    def f():
        u.goto(BASE + "/application")
        txt = u.locator("main").inner_text()
        assert "Account created" not in txt and "Comment karma" in txt  # requirement list present, but no fabricated values
        assert not re.search(r"Retrieved from Reddit", txt), "must not claim Reddit retrieval"
    check("no verified values are shown or invented before verification", f)

    def f():
        u.goto(BASE + "/tasks"); expect(u.get_by_text("Tasks unlock after approval")).to_be_visible()
        u.goto(BASE + "/dashboard"); expect(u.get_by_text("Waiting for administrator review")).to_be_visible()
        expect(u.get_by_text("Apply for More Tasks")).to_have_count(0)
        no_overflow(u); shot(u, "11-dashboard-pending")
    check("pending user still cannot reach tasks", f)

    # ---------------------------------------------------------------- admin
    def f():
        a.goto(BASE + "/admin/login")
        a.get_by_label("Email address").fill(ADMIN_EMAIL); a.get_by_label("Password", exact=True).fill("wrong-password-123")
        a.get_by_role("button", name="Log in").click()
        a.wait_for_timeout(300); expect(a.get_by_role("button", name="Log in")).to_be_enabled(); a.wait_for_load_state("networkidle")
        expect(a.get_by_text("Incorrect email or password")).to_be_visible()
        # an ordinary user cannot log in through the admin form
        a.get_by_label("Email address").fill("e2e@example.test"); a.get_by_label("Password", exact=True).fill(PW)
        a.get_by_role("button", name="Log in").click()
        a.wait_for_timeout(300); expect(a.get_by_role("button", name="Log in")).to_be_enabled(); a.wait_for_load_state("networkidle")
        expect(a.get_by_text("Incorrect email or password")).to_be_visible()
        shot(a, "12-admin-login-error", full=False)
    check("admin login rejects wrong password and ordinary users (same generic message)", f)

    def f():
        a.get_by_label("Email address").fill(ADMIN_EMAIL); a.get_by_label("Password", exact=True).fill(ADMIN_PW)
        a.get_by_role("button", name="Log in").click(); a.wait_for_url(BASE + "/admin")
        expect(a.get_by_text("Pending applications")).to_be_visible()
        shot(a, "13-admin-overview")
    check("administrator can log in and sees the overview", f)

    def f():
        # the user session cookie must not open the admin area
        c = browser.new_context(); pg = c.new_page()
        pg.goto(BASE + "/login"); pg.get_by_label("Email address").fill("e2e@example.test"); pg.get_by_label("Password", exact=True).fill(PW)
        pg.get_by_role("button", name="Log in").click(); pg.wait_for_url(re.compile("/dashboard"))
        pg.goto(BASE + "/admin"); assert pg.url.startswith(BASE + "/admin/login"), pg.url
        pg.goto(BASE + "/admin/applications"); assert pg.url.startswith(BASE + "/admin/login"), pg.url
        c.close()
    check("a logged-in ordinary user cannot open admin pages", f)

    def f():
        a.goto(BASE + "/admin/applications?status=Pending+Admin+Review")
        expect(a.locator("tr", has_text="e2e_user")).to_be_visible()
        shot(a, "14-admin-queue")
        a.locator("tr", has_text="e2e_user").get_by_role("link", name="Review").click()
        a.wait_for_url(re.compile("/admin/applications/"))
        expect(a.get_by_role("link", name=re.compile("Open Reddit profile in a new tab"))).to_be_visible()
        href = a.get_by_role("link", name=re.compile("Open Reddit profile in a new tab")).get_attribute("href")
        assert href == "https://www.reddit.com/user/E2E_Redditor/", href
        assert a.get_by_role("link", name=re.compile("Open Reddit profile")).get_attribute("target") == "_blank"
        shot(a, "15-admin-review")
    check("admin queue lists the application; profile opens in a new tab", f)

    def f():
        a.get_by_role("button", name="Approve", exact=True).click()
        expect(a.get_by_text(re.compile("Verified account values are required"))).to_be_visible()
        expect(a.locator("main").get_by_text("Pending Admin Review").first).to_be_visible()
    check("approval is refused until verified values exist", f)

    def f():
        a.once("dialog", lambda d: d.accept())
        a.get_by_role("button", name="Reject", exact=True).click()
        expect(a.get_by_text("A rejection reason is required")).to_be_visible()
    check("rejecting requires a reason", f)

    def f():
        d = (datetime.date.today() - datetime.timedelta(days=400)).isoformat()
        a.get_by_label("Account created on").fill(d)
        a.get_by_label("Comment karma").fill("500"); a.get_by_label("Post karma").fill("400")
        a.get_by_label("Evidence note").fill("Read from the profile page during e2e test")
        a.get_by_role("button", name="Save verified values").click()
        expect(a.get_by_text("Verified values saved")).to_be_visible()
        expect(a.get_by_text("All minimums are met")).to_be_visible()
        expect(a.get_by_text("Entered by an administrator").first).to_be_visible()
    check("admin enters verified values manually (audited); minimums evaluate", f)

    def f():
        # Values are in, but the admin has not confirmed the ownership code yet: approval must still be refused.
        a.wait_for_load_state("networkidle")
        a.get_by_role("button", name="Approve", exact=True).click()
        expect(a.get_by_text(re.compile("Ownership of this Reddit account is not confirmed"))).to_be_visible()
    check("approval is refused until account ownership is confirmed", f)

    def f():
        a.get_by_label("Comment karma").fill("500"); a.get_by_label("Post karma").fill("400")
        a.get_by_label("Account created on").fill((datetime.date.today() - datetime.timedelta(days=400)).isoformat())
        a.get_by_label("Evidence note").fill("Code found in the bio during e2e test")
        a.get_by_label(re.compile("I found the user.s code")).check()
        a.get_by_role("button", name="Save verified values").click()
        expect(a.get_by_text("Verified values saved")).to_be_visible()
    check("admin confirms ownership code and re-saves values", f)

    def f():
        a.wait_for_load_state("networkidle")
        a.get_by_role("button", name="Approve", exact=True).click()
        expect(a.get_by_text("Application approved")).to_be_visible()
    check("admin approves the application", f)

    # ---------------------------------------------------------------- approved user
    def f():
        u.goto(BASE + "/dashboard")
        expect(u.get_by_text("You are approved")).to_be_visible()
        expect(u.get_by_role("link", name=re.compile("Apply for More Tasks"))).to_be_visible()
        expect(u.get_by_text("Entered by an administrator").first).to_be_visible()
        expect(u.get_by_text("500").first).to_be_visible()
        no_overflow(u); shot(u, "16-dashboard-approved")
    check("approved user sees 'Apply for More Tasks' and real (admin-entered, labelled) values", f)

    def f():
        u.goto(BASE + "/eligibility")
        expect(u.get_by_role("heading", name=re.compile("Subreddits you qualify for"))).to_be_visible()
        expect(u.get_by_role("heading", name="r/TestSubA")).to_be_visible()
        txt = u.locator("main").inner_text()
        assert "Currently unavailable" in txt and "r/TestSubC" in txt
        assert re.search(r"Comment karma: at least 2,?000 · yours is 500", txt), "unmet requirement not explained"
        no_overflow(u); shot(u, "17-eligibility")
    check("eligibility page: eligible vs unavailable, with exact unmet requirement", f)

    # admin adds a rewarded task
    def f():
        a.goto(BASE + "/admin/tasks/new")
        a.get_by_label("Task title").fill("E2E rewarded task")
        a.get_by_label("Subreddit").select_option(label="r/TestSubA")
        a.get_by_label("Short description").fill("An end-to-end test task")
        a.get_by_label("Instructions").fill("Follow the steps.")
        a.get_by_label(re.compile("Reward in")).fill("150")
        a.get_by_role("button", name="Add task").click(); a.wait_for_url(re.compile("/admin/tasks"))
        expect(a.get_by_text("E2E rewarded task")).to_be_visible()
    check("admin adds a task with a reward", f)

    def f():
        u.goto(BASE + "/tasks")
        titles = u.locator("h2").all_inner_texts()
        assert "E2E rewarded task" in titles and "Test task A" in titles, titles
        assert "Test task C" not in titles, "ineligible subreddit task leaked"
        u.get_by_label("Search tasks").fill("rewarded"); u.get_by_role("button", name="Filter").click()
        u.wait_for_url(re.compile("q=rewarded"))
        assert u.locator("h2").all_inner_texts() == ["E2E rewarded task"], u.locator("h2").all_inner_texts()
        no_overflow(u); shot(u, "18-tasks")
    check("marketplace shows only eligible tasks; search works", f)

    def f():
        u.get_by_role("link", name="View and apply").click()
        expect(u.get_by_text("Applying doesn't earn anything", exact=False)).to_be_visible()
        shot(u, "19-task-detail")
        u.get_by_role("button", name="Apply for this task").click()
        u.wait_for_url(re.compile("/tasks/mine"))
        expect(u.get_by_text("Application submitted")).to_be_visible()
        expect(u.locator("main").get_by_text("Applied", exact=True).first).to_be_visible()
        shot(u, "20-my-tasks")
    check("user applies; duplicate hidden afterwards", f)

    def f():
        u.goto(BASE + "/wallet"); expect(u.get_by_text("₹0.00").first).to_be_visible()  # applying earns nothing
    check("applying does not credit the wallet", f)

    # ---------------------------------------------------------------- admin completes task with reward
    def f():
        a.goto(BASE + "/admin/task-applications")
        def open_update(card):
            # The section stays open after an action re-renders, so only click when it is closed.
            if card.locator("details").get_attribute("open") is None:
                card.get_by_text("Update status").click()
        card = a.locator("li", has_text="E2E rewarded task").first
        open_update(card)
        card.get_by_role("button", name="Accept").click()
        expect(a.get_by_text("Marked accepted")).to_be_visible()
        a.wait_for_load_state("networkidle")
        card = a.locator("li", has_text="E2E rewarded task").first
        open_update(card)
        card.get_by_label(re.compile("credit ₹150.00")).check()
        card.get_by_role("button", name="Mark completed").click()
        expect(a.get_by_text("reward was credited")).to_be_visible()
        shot(a, "21-admin-task-apps")
    check("admin accepts then completes with explicit reward credit", f)

    def f():
        u.goto(BASE + "/wallet")
        expect(u.get_by_text("₹150.00").first).to_be_visible()
        expect(u.get_by_text("Reward for task: E2E rewarded task")).to_be_visible()
        no_overflow(u); shot(u, "22-wallet")
    check("wallet shows the credited reward in the ledger", f)

    # ---------------------------------------------------------------- admin wallet adjustment
    def f():
        a.goto(BASE + "/admin/wallet?find=e2e")
        a.get_by_role("link", name="Select").first.click()
        a.get_by_label("Amount in ₹").fill("20"); a.get_by_label("Type", exact=True).select_option("debit")
        a.get_by_label(re.compile("Reason")).fill("Test correction")
        a.once("dialog", lambda d: d.accept())
        a.get_by_role("button", name="Record adjustment").click()
        expect(a.get_by_text("Adjustment recorded")).to_be_visible()
        expect(a.get_by_text("Test correction").first).to_be_visible()
        shot(a, "23-admin-wallet")
    check("admin wallet adjustment recorded with reason and author", f)

    def f():
        u.goto(BASE + "/wallet"); expect(u.get_by_text("₹130.00").first).to_be_visible()
    check("balance reflects the debit (₹150 − ₹20)", f)

    # ---------------------------------------------------------------- admin pages render
    for path, nm, needle in [("/admin/subreddits", "24-admin-subreddits", "TestSubA"), ("/admin/users", "25-admin-users", "e2e_user"), ("/admin/audit", "26-admin-audit", "wallet.adjust"), ("/admin/settings", "27-admin-settings", "Platform-wide minimums")]:
        def f(path=path, nm=nm, needle=needle):
            a.goto(BASE + path); expect(a.get_by_text(needle).first).to_be_visible(); shot(a, nm)
        check(f"admin page {path} renders", f)

    def f():
        a.goto(BASE + "/admin/audit")
        txt = a.locator("main").inner_text()
        for act in ["submission.approve", "submission.manual_values", "task_application.decide", "wallet.adjust", "auth.admin_login"]:
            assert act in txt, f"{act} missing from audit log"
    check("audit log recorded the sensitive admin actions", f)

    # admin on a phone
    def f():
        m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = m.new_page(); pg.goto(BASE + "/admin/login")
        pg.get_by_label("Email address").fill(ADMIN_EMAIL); pg.get_by_label("Password", exact=True).fill(ADMIN_PW)
        pg.get_by_role("button", name="Log in").click(); pg.wait_for_url(BASE + "/admin")
        no_overflow(pg); shot(pg, "28-admin-mobile-overview")
        pg.goto(BASE + "/admin/applications"); no_overflow(pg); shot(pg, "29-admin-mobile-queue")
        m.close()
    check("admin panel usable on a 390px phone", f)

    # keyboard / a11y basics
    def f():
        u.goto(BASE + "/login")
        u.keyboard.press("Tab"); focused = u.evaluate("document.activeElement.className")
        assert "skip-link" in focused, focused
    check("keyboard: first Tab stop is the skip link", f)

    browser.close()

print("\n--- console / page errors ---")
seen = set()
for url, msg in console_errors:
    k = (url, msg)
    if k not in seen:
        seen.add(k); print(url, "|", msg[:200])
if not console_errors: print("none")
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
