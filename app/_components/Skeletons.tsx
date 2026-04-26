"use client";

export function SpotlightSkeleton() {
  return (
    <div className="spotlight-wrap" aria-hidden>
      <div className="spotlight">
        <div className="sk sk-fill spot-bg-skel" />
        <div className="spot-shade" />
        <div className="spot-inner">
          <div className="spot-text">
            <div className="sk sk-spot-title" />
            <div className="chips">
              <div className="sk sk-chip" />
              <div className="sk sk-chip" style={{ width: 56 }} />
              <div className="sk sk-chip" style={{ width: 64 }} />
            </div>
            <div className="sk sk-line" style={{ width: "90%", marginTop: 12 }} />
            <div className="sk sk-line" style={{ width: "85%" }} />
            <div className="sk sk-line" style={{ width: "55%" }} />
            <div className="actions" style={{ marginTop: 22 }}>
              <div className="sk sk-btn" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RowSkeleton({ count = 7 }: { count?: number }) {
  return (
    <div className="row" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div className="card" key={i}>
          <div className="poster"><div className="sk sk-fill" /></div>
          <div className="meta">
            <div className="sk sk-line" style={{ width: "75%", height: 12 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
