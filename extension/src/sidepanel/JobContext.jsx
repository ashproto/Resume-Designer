function Description({ text }) {
  const paragraphs = String(text).split(/\n\s*\n/).filter((line) => line.trim());
  return <div className="job-description">{paragraphs.map((paragraph, index) => (
    <div key={index}>{paragraph.split('\n').filter((line) => line.trim()).map((line, lineIndex) => {
      const value = line.trim();
      if (/^[-•▪*]\s/.test(value)) return <p className="job-description-bullet" key={lineIndex}>{value.replace(/^[-•▪*]\s*/, '')}</p>;
      if (value.length < 80 && (/[:：]$/.test(value) || /^(about (the role|us)|responsibilities|qualifications|requirements|what you.ll (do|bring)|benefits)$/i.test(value))) {
        return <h4 key={lineIndex}>{value.replace(/[:：]$/, '')}</h4>;
      }
      return <p key={lineIndex}>{value}</p>;
    })}</div>
  ))}</div>;
}

export default function JobContext({ job, description, compact = false, manual = false }) {
  if (!job) return null;
  const locations = [...new Set((Array.isArray(job.locations) ? job.locations : [job.location])
    .map((location) => String(location ?? '').trim()).filter(Boolean))];
  const capturedDescription = String((manual ? description : job.description || description) || '').trim();
  return (
    <section className={`captured-job ${compact ? 'captured-job--compact' : ''}`} aria-label="Captured job details">
      <p className="eyebrow">{manual ? 'Entered manually' : 'Captured job description'}</p>
      <h3>{job.title || (manual ? 'Job description' : 'Job title not found')}</h3>
      {!manual || job.company ? <p className="job-company">{job.company || 'Company not found'}</p> : null}
      {!manual || locations.length ? <p className="job-location">{locations.length ? locations.join(' · ') : 'Location not listed'}</p> : null}
      {!compact && capturedDescription ? (
        <details className="captured-description">
          <summary>{manual ? 'Review job description' : 'Review captured job description'}</summary>
          <Description text={capturedDescription} />
        </details>
      ) : null}
    </section>
  );
}
