import React, { useState } from "react";
import GlassDialog from "../glass/GlassDialog";
import { useI18n } from "../hooks/useI18n";

interface ImportMusicDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (url: string) => Promise<boolean>;
}

const ImportMusicDialog: React.FC<ImportMusicDialogProps> = ({
  isOpen,
  onClose,
  onImport,
}) => {
  const { dict } = useI18n();
  const [importUrl, setImportUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleImport = async () => {
    if (!importUrl.trim() || isLoading) return;

    setIsLoading(true);
    try {
      const success = await onImport(importUrl);
      if (success) {
        setImportUrl("");
        onClose();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setImportUrl("");
    onClose();
  };

  return <GlassDialog open={isOpen} onClose={handleClose} title={dict.import.title}>
    <div className="glass-dialog-body">
      <h2>{dict.import.title}</h2>
      <p className="glass-description mt-2">{dict.import.hintStart} <strong>{dict.import.hintBrand}</strong> {dict.import.hintEnd}</p>
      <input type="text" className="glass-input mt-5" value={importUrl}
        onChange={(event) => setImportUrl(event.target.value)} placeholder={dict.import.placeholder}
        aria-label={dict.import.placeholder} disabled={isLoading} autoFocus
        onKeyDown={(event) => { if (event.key === "Enter") void handleImport(); }} />
    </div>
    <div className="glass-dialog-actions">
      <button className="glass-button" onClick={handleClose}>{dict.import.cancel}</button>
      <button className="glass-button glass-primary" disabled={isLoading || !importUrl.trim()} onClick={handleImport}>
        {isLoading ? dict.import.loading : dict.import.action}
      </button>
    </div>
  </GlassDialog>;
};
export default ImportMusicDialog;
