"use client";

export function Footer(props: { dataAsAt: string; historicSourceDate: string; source: string }) {
  return (
    <footer className="ft">
      <div className="ft-left">
        <img src="/brand/resource-logo-mark-white.png" alt="" className="ft-mark" />
        <span className="ft-tag">Innovative Recycling Solutions</span>
      </div>
      <div className="ft-right">
        <span>Source: {props.source}</span>
        <span className="ft-dot">•</span>
        <span>Solar history from {props.historicSourceDate}</span>
        <span className="ft-dot">•</span>
        <span>Data as at {props.dataAsAt}</span>
      </div>
    </footer>
  );
}
