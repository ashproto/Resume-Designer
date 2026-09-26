// These questions must be answered directly by the applicant on the website.
// This is a conservative, local safeguard; unfamiliar wording may still need review.
export const SENSITIVE_MANUAL_MESSAGE = 'Answer this sensitive or consent question directly on the application page. It will not be autofilled or saved.';

function normalized(value) {
  return String(value ?? '').replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isSensitiveQuestion(question) {
  const label = normalized(question);
  return /\b(?:eeo|eeoc|demographic|demographics|race|racial|ethnicity|ethnic|gender|sex|pronouns?|disability|disabilities|disabled|nationality|citizenship|citizen|religion|religious|salary|compensation|remuneration|ssn|consent|wages?)\b/.test(label)
    || /\b(?:date of birth|birth date|birthdate|birthday|dob|sexual orientation|social security|equal employment opportunity|equal opportunity|medical condition|health condition|marital status|immigration|work authori[sz]ation|visa sponsorship)\b/.test(label)
    || /\b(?:desired|expected|current|annual|hourly|starting) (?:annual |hourly )?(?:pay|rate)\b|\bpay (?:expectations?|requirements?|range)\b/.test(label)
    || /\b(?:work eligibility|authori[sz]ation to work|permanent residen(?:t|ce|cy)|green card|residency status)\b/.test(label)
    || /\b(?:authori[sz]ed|eligible|entitled|permitted|allowed) to work\b|\b(?:legal )?right to work\b|\blegally able to work\b/.test(label)
    || /\bwork(?:ing)? (?:permits?|visas?)\b|\bvisa (?:status|type|category)\b/.test(label)
    || /\b(?:need|require|requires|required)\b.{0,100}\bsponsor(?:ship)?\b|\bsponsorship\b.{0,60}\b(?:required|needed)\b/.test(label)
    || /\b(?:with|without) (?:employer )?sponsorship\b/.test(label)
    || /\b(?:protected|military) veteran\b|\bveteran(?:s)? status\b|\bare you (?:a |an )?veteran\b|^veteran(?:s)?[?*:. ]*$/.test(label)
    || /\b(?:i agree|i accept|do you agree|do you accept|acknowledge|certify|terms(?: and conditions| of (?:service|use))?|privacy policy|i (?:have )?read|i confirm|opt in|subscribe|newsletter|send me (?:updates|offers)|receive (?:marketing|communications|updates))\b/.test(label);
}

export function isSensitiveDescriptor(descriptor) {
  if (descriptor?.sensitive === true || descriptor?.manualSensitive === true) return true;
  if (isSensitiveQuestion(descriptor?.label)) return true;
  const options = (Array.isArray(descriptor?.options) ? descriptor.options : [])
    .flatMap((option) => [normalized(option?.label), normalized(option?.value)]);
  return (options.includes('male') && options.includes('female'))
    || options.some((option) => /\b(?:non binary|transgender|hispanic|latino|african american|american indian|protected veteran|disabled veteran|have a disability)\b/.test(option));
}
