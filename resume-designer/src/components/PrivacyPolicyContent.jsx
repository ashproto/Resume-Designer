import { PRIVACY_POLICY_DATE, PRIVACY_POLICY_SECTIONS, PRIVACY_SUPPORT_URL } from '../privacyPolicy.js';

export function PrivacyPolicyContent() {
  return (
    <div className="space-y-5 text-sm leading-relaxed">
      <p className="text-muted-foreground">Last updated {PRIVACY_POLICY_DATE}</p>
      {PRIVACY_POLICY_SECTIONS.map((section) => (
        <section key={section.title} className="space-y-2">
          <h3 className="font-semibold">{section.title}</h3>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      ))}
      <p>
        <a href={PRIVACY_SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">
          Contact the project about privacy (public GitHub issues)
        </a>
      </p>
    </div>
  );
}
