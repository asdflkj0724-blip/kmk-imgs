'use client';

export default function PrintButton() {
  return (
    <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}>
      PDFとして保存・印刷する
    </button>
  );
}
