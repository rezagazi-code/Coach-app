/** Tab (a) — the finalized standalone questionnaire, rendered in an iframe. */
export default function QuestionnaireTab() {
  return (
    <iframe
      title="پرسش‌نامه هوشمند مربی"
      src="questionnaire.html"
      className="questionnaire-frame-tab"
      allowFullScreen
    />
  );
}
