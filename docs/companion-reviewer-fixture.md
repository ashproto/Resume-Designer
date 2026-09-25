# Fictional Companion reviewer fixture

Prepared source materials; **not deployed**. These are synthetic examples authored for review, with no copied user storage, provider keys, or pairing credentials.

| Material | Repository source |
| --- | --- |
| Application page | [`website/companion-demo.html`](../website/companion-demo.html) |
| Source resume | [`docs/fixtures/companion-reviewer-resume.json`](fixtures/companion-reviewer-resume.json) |
| Website download (identical copy) | [`website/assets/companion-reviewer-resume.json`](../website/assets/companion-reviewer-resume.json) |
| Complete reviewer flow | [`docs/chrome-web-store-reviewer-instructions.md`](chrome-web-store-reviewer-instructions.md) |

## First launch, if the welcome wizard blocks the main window

The owner committed to supplying a dedicated OpenRouter key privately in the Dashboard **Password** field; actual supply remains unconfirmed. Once supplied, configure that key in the native wizard, choose **Import existing resume**, and paste the fictional text below into **Import your resume**. Review the parsed facts, continue to **Create resume**, and finish onboarding. This initial parse uses real AI. Once the main window is available, follow the JSON import steps below for an exact source document; the first-run wizard’s file picker accepts TXT/PDF/DOCX, not this JSON document.

```text
Alex Morgan — Senior Product Designer
Washington, DC | alex.morgan@example.com | +1 202-555-0147
Portfolio: https://alex-morgan.example
Product designer experienced in accessible collaboration software, customer interviews,
Figma prototypes, design systems, and responsive web products.
Available to start within two weeks.
Senior Product Designer, Northline Tools (fictional), January 2021–Present:
Led collaboration workflow design from customer research through delivery;
created and tested prototypes; maintained accessible components with engineers.
Product Designer, Cedar Works (fictional), June 2017–December 2020:
Designed responsive web interfaces, ran usability research, and shipped workflow improvements.
BA Interaction Design, Example Design College (fictional), 2017.
Skills: interaction design, user research, accessible design systems, Figma, HTML, CSS.
```

## Desktop setup

1. For the first macOS-only Unlisted release, use macOS 14.4 or later and install the signed production On Paper for macOS build that contains this companion bridge; the existing public `v2.2.0` is incompatible. Keep one app instance running. Use a fresh reviewer workspace; do not overwrite an existing profile or import a full backup.
2. Open **Settings → Account → New profile**, name it **Companion Review (Fictional)**, and choose **Create & switch**. This workspace starts empty. If onboarding appears after switching profiles, use its **Cancel** control so you can import the prepared resume.
3. Download `companion-reviewer-resume.json` using **Download the fictional resume (JSON)** in the page’s **Set up the fictional reviewer resume** section. In the main window’s **Resume actions** menu (the three dots beside the resume selector), choose **Import…** and select the downloaded file. In a narrow window, use **Menu → Import**. Do not use **Import profile** for this resume document. This imports one resume; it is not a full-workspace backup. Rename the imported resume to **Product Design** using the same menu if desired.
4. Verify the resume shows **Alex Morgan**, `alex.morgan@example.com`, `+1 202-555-0147`, and `https://alex-morgan.example`. The companies, college, contact details, and career history are fictional. Keep the underlying career profile empty or enter only these same fictional facts through **Profile**; personal data is unnecessary.
5. Enter the dedicated review-only key from the Dashboard **Password** field directly in **Settings → AI** and select the tested **Claude Sonnet 4.6** model. Accept the native AI-sharing disclosure. Do not put a key into this repository, fixture, extension, screenshots, or public reviewer notes. Provider operations are real and may be billable.

The resume explicitly states two-week availability. Other than the provided facts, no additional claims are needed. Do not add answers to sensitive work-authorization or EEO questions.

## Local page setup

From the repository root, run:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory website
```

Open `http://127.0.0.1:8765/companion-demo.html` in Chrome. Its relative download link serves `http://127.0.0.1:8765/assets/companion-reviewer-resume.json`. Invoke Companion from the toolbar on that tab, accept its disclosure, pair, and select **Product Design** (or the original import filename). Follow the full reviewer instructions for automatic/manual pairing.

For Store review, deploy the page and its JSON asset together through the website’s normal authorized deployment, then verify both URLs. The existing Pages workflow uploads the whole `website/` directory. These planned URLs are **not deployed or verified** by this preparation:

- Page and on-page setup: `https://onpaper.pro/companion-demo.html`
- Fictional resume download: `https://onpaper.pro/assets/companion-reviewer-resume.json`

The page uses a relative download link so the same source works locally and after deployment. Keep the website JSON byte-identical to `docs/fixtures/companion-reviewer-resume.json` when updating the fixture. No localhost server or private developer filesystem should be required of Store reviewers. The owner committed to providing the dedicated, spending-capped review key through the private Dashboard **Password** field, with **Username** blank. Actual supply and continued model access must be confirmed before review; no On Paper login or reviewer-funded OpenRouter account is required. The compatible signed macOS installer remains unavailable.

## Expected results

- Nine form controls: name, email, phone, portfolio, availability, motivation, resume PDF, work authorization, and EEO gender.
- Six ordinary answers plus the PDF can be reviewed and filled. Two sensitive controls remain blank and manual. Availability may require the reviewer to select **Within two weeks** if the model leaves it for confirmation.
- The motivation response should connect the supplied design-systems, research, and collaboration experience to the fictional role. Wording and fit score vary by model; do not require a specific sentence or score.
- After the seven supported fields are populated, **Preview demo application** reports **7 of 9 fields completed**. The native file input shows the attached PDF. The fixture does not submit to an employer or upload the file.
- Fit analysis should explain strengths/gaps. Tailoring should create a separate copy for **Senior Product Designer — Fieldwork Studio (fictional demo)** and refresh the extension’s resume/review selection. Logging creates an explicitly requested record in the fictional profile.

## Fixture boundaries

The page has no form endpoint, external scripts, analytics, automatic network calls, or storage writes. Its CSP blocks form actions and script-initiated network connections; the submit handler also cancels normal submission. Clicking the download link requests only the static fictional JSON from the same website; no form values or attached files are sent with that download. Form values and selected files remain in this tab and clear when the page reloads. It is marked `noindex,nofollow` to avoid presenting the fictional JobPosting metadata as a recruiting listing. Normal static-host request logs still depend on the website host.

Those page boundaries do not disable the extension’s disclosed app/AI requests. When the reviewer asks for assistance, Companion still communicates with On Paper and the chosen provider. Workspace information can sync through the reviewer’s iCloud account on supported devices; use only these fictional materials.

The JSON was checked against the app’s actual `assertResumeData(..., { requireIdentity: true })` import validator. Its top-level fields are resume document data, not a profile/full-backup envelope. Live import and final production-install checks remain part of release verification.
