# Job-board fixture sources

Captured and verified on 2026-07-15 against blank public application forms. No data was entered or submitted, and the fixtures contain no applicant data.

- Greenhouse: https://job-boards.greenhouse.io/withmeinc/jobs/4594710008
- Lever: https://jobs.lever.co/intersect/414106b8-e9e8-4404-91ee-c42b98cdf5cf/apply
- Ashby: https://jobs.ashbyhq.com/Gelato/b50bdb40-d152-4e43-8330-5728361f33cc/application
- Ashby checkbox variant: https://jobs.ashbyhq.com/aureliussystems/25ef7175-1d53-4629-9d39-b7b3343cd130/application

The HTML is sanitized while preserving the field relationships used by the scanner: associated and wrapping labels, fieldsets and legends, ARIA grouping and required state, custom comboboxes, same-name radio and checkbox controls, upload structure, and intentional missing identifiers. Employer-specific generated identifiers, scripts, tracking, CAPTCHA, styling noise, prose, and generated values were removed or replaced with deterministic tokens.
