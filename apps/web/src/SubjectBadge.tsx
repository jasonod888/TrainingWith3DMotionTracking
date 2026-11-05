/** Labels come from the server catalogue; older body projections keep their existing default. */
export function SubjectBadge({label}:{label?:string|null}){
 const value=label||'Full Body Movement';
 return <span className="lesson-subject-badge" aria-label={`Lesson subject: ${value}`}>{value}</span>;
}
