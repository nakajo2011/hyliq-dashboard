import { useRef, useState } from "react";

interface Props {
  onFiles: (files: File[]) => void;
}

export function Dropzone({ onFiles }: Props) {
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = Array.from(list).filter((f) =>
      f.name.toLowerCase().endsWith(".csv")
    );
    if (files.length > 0) onFiles(files);
  };

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${hover ? "#6cf" : "#3a4258"}`,
        background: hover ? "#1a2030" : "#141823",
        borderRadius: 10,
        padding: "2.5rem 1.5rem",
        textAlign: "center",
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <p style={{ margin: 0, fontSize: "1.05rem" }}>
        CSV ファイルをここにドラッグ&ドロップ、またはクリックして選択
      </p>
      <p style={{ margin: "0.5rem 0 0", color: "#888", fontSize: "0.85rem" }}>
        trade_history_*.csv / funding_history.csv / deposits_and_withdrawals.csv
      </p>
    </div>
  );
}
