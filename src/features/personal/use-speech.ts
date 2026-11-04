import { useCallback, useEffect, useRef, useState } from 'react';

/** Reconhecimento de voz do navegador (Web Speech API), em português do Brasil. */

interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'O microfone está bloqueado. Libere o acesso ao microfone nas configurações do navegador para este site.',
  'service-not-allowed': 'O navegador não permitiu usar o reconhecimento de voz. Use o microfone do teclado.',
  'no-speech': 'Não ouvi nada. Toque no microfone e fale de novo.',
  'audio-capture': 'Não encontrei um microfone neste aparelho.',
  network: 'Sem conexão com o serviço de voz do navegador. Use o microfone do teclado.',
  'language-not-supported': 'O navegador não entende português neste aparelho. Use o microfone do teclado.',
};

export interface SpeechState {
  supported: boolean;
  listening: boolean;
  /** Texto reconhecido até agora (parcial enquanto fala). */
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/** `onFinal` recebe a frase quando a pessoa termina de falar. */
export function useSpeech(onFinal: (text: string) => void): SpeechState {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  });
  const supported = recognitionConstructor() !== null;

  const stop = useCallback(() => recognition.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionConstructor();
    if (!Ctor) return setError('Este navegador não tem reconhecimento de voz. Use o microfone do teclado.');
    setError(null);
    setInterim('');
    const rec = new Ctor();
    rec.lang = 'pt-BR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    // Quando o aparelho permite, reconhece sem enviar o áudio para a nuvem.
    try {
      if ('processLocally' in rec) rec.processLocally = true;
    } catch {
      // navegador sem esse recurso
    }
    let finalText = '';
    rec.onresult = (event) => {
      let partial = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += `${text} `;
        else partial += text;
      }
      setInterim((finalText + partial).trim());
    };
    rec.onerror = (event) => setError(ERRORS[event.error] ?? 'Não consegui ouvir. Tente de novo ou use o microfone do teclado.');
    rec.onend = () => {
      setListening(false);
      recognition.current = null;
      const text = finalText.trim();
      if (text) onFinalRef.current(text);
    };
    recognition.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      setError('Não foi possível iniciar o microfone. Tente de novo.');
    }
  }, []);

  useEffect(() => () => recognition.current?.abort(), []);

  return { supported, listening, interim, error, start, stop };
}
