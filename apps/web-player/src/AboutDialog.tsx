import React from "react";
import { useI18n } from "@aura-music/view/hooks/useI18n";
import { AuraLogo } from "@aura-music/view/components/Icons";
import GlassDialog from "@aura-music/view/glass/GlassDialog";
import manifest from "../package.json";

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const AboutDialog: React.FC<AboutDialogProps> = ({ isOpen, onClose }) => {
  const { dict } = useI18n();
  return <GlassDialog open={isOpen} onClose={onClose} title={dict.top.about}>
    <div className="glass-dialog-body">
      <div className="w-16 h-16 rounded-[18px] overflow-hidden mb-5 shadow-lg"><AuraLogo className="w-full h-full" /></div>
      <h2>Aura Music</h2>
      <p className="glass-caption mt-1">Version {manifest.version}</p>
      <p className="glass-description mt-5">{dict.about.descStart}<strong> {dict.about.descEmphasis} </strong>{dict.about.descEnd}</p>
      <div className="glass-links mt-5">
        <a href="https://github.com/dingyi222666/aura-music" target="_blank" rel="noreferrer">{dict.about.viewGitHub}</a>
        <a href="https://github.com/dingyi222666" target="_blank" rel="noreferrer">{dict.about.createdBy}</a>
      </div>
      <p className="glass-caption mt-5 text-xs">Gemini 3.5 Flash / GPT 6 Astra / Claude Fable 5.1</p>
    </div>
    <div className="glass-dialog-actions"><button className="glass-button glass-primary" onClick={onClose}>{dict.about.done}</button></div>
  </GlassDialog>;
};
export default AboutDialog;
