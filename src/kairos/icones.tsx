// Os ícones do Kairós: traço fino, uma cor só, no lugar dos emojis de antes.
import Svg, { Path, Rect } from 'react-native-svg';

export type NomeIcone =
  | 'mais'
  | 'editar'
  | 'excluir'
  | 'dossie'
  | 'ia'
  | 'elo'
  | 'copiar'
  | 'check'
  | 'fechar'
  | 'data'
  | 'pular'
  | 'desfazer';

const TRACOS: Record<NomeIcone, string[]> = {
  mais: ['M12 5v14', 'M5 12h14'],
  editar: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  excluir: ['M4 7h16', 'M9.5 7V4.5h5V7', 'M6.5 7l.9 12.5h9.2l.9-12.5', 'M10.5 11v5', 'M13.5 11v5'],
  dossie: ['M4 20h16', 'M7.5 16.5v-5', 'M12 16.5V7', 'M16.5 16.5V10'],
  // a faísca de quatro pontas: "fazer com IA"
  ia: ['M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z', 'M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z'],
  elo: ['M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1', 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'],
  copiar: ['M5 15V6a2 2 0 0 1 2-2h9'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  fechar: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  data: ['M3.5 10h17', 'M8 3.5v3', 'M16 3.5v3'],
  pular: ['M6 6.5l7 5.5-7 5.5z', 'M17 6.5v11'],
  desfazer: ['M9 14L4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
};

export function Icone({ nome, size = 18, cor, espessura = 1.7 }: { nome: NomeIcone; size?: number; cor: string; espessura?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={cor} strokeWidth={espessura} strokeLinecap="round" strokeLinejoin="round">
      {nome === 'copiar' && <Rect x={9} y={8} width={11} height={12.5} rx={2} />}
      {nome === 'data' && <Rect x={3.5} y={5} width={17} height={15} rx={2.5} />}
      {TRACOS[nome].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}

const ESTRELA = 'M12 3.6l2.55 5.2 5.75.83-4.16 4.05.98 5.72L12 16.7l-5.12 2.7.98-5.72L3.7 9.63l5.75-.83z';

/** Uma estrela da nota: cheia ou só o contorno. */
export function Estrela({ cheia, size = 16, cor }: { cheia: boolean; size?: number; cor: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={ESTRELA} fill={cheia ? cor : 'none'} stroke={cor} strokeWidth={1.5} strokeLinejoin="round" />
    </Svg>
  );
}
