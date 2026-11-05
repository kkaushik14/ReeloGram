/** Reserved spaces follow the real layout, so loading does not move the controls. */
export function AccountSkeleton() {
  return (
    <span
      className="account-skeleton loading-shimmer"
      role="status"
      aria-label="Checking your account"
    />
  );
}
export function FeedSkeleton() {
  return (
    <div className="video-grid" aria-hidden="true">
      {[1, 2, 3].map((index) => (
        <div className="skeleton" key={index}>
          <div />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
export function ReelSkeleton() {
  return (
    <div className="reel-loading-layout" aria-hidden="true">
      <div className="reel-loading-controls">
        {[1, 2, 3, 4].map((index) => (
          <span key={index} className="loading-shimmer" />
        ))}
      </div>
      <div className="reel-loading-screen loading-shimmer" />
      <div className="reel-loading-copy">
        <span className="loading-shimmer" />
        <span className="loading-shimmer" />
        <span className="loading-shimmer" />
      </div>
    </div>
  );
}
export function FormSkeleton() {
  return (
    <div className="form-loading" aria-hidden="true">
      {[1, 2, 3].map((index) => (
        <div className="form-loading-panel" key={index}>
          <span className="loading-shimmer" />
          <div className="loading-shimmer" />
        </div>
      ))}
    </div>
  );
}
export function AuthSkeleton() {
  return (
    <div className="auth-scene recovery-scene">
      <section
        className="auth-card auth-loading"
        role="status"
        aria-label="Loading your account form"
      >
        <span className="loading-shimmer" />
        <span className="loading-shimmer" />
        <div className="loading-shimmer" />
        <div className="loading-shimmer" />
      </section>
    </div>
  );
}
