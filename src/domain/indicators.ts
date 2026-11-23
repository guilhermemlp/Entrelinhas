// Catálogo de indicadores. Espelha a tabela indicator_def do banco.
// Qualquer alteração aqui exige migração correspondente.
// Todos os indicadores são escalas de INTENSIDADE 0–10 (0 = ausente, 10 = máxima).
// Não há indicadores "bons" ou "ruins": a leitura é feita na análise.

export type DimensionKey =
  | 'mood' | 'energy' | 'cognition' | 'anxiety'
  | 'impulsivity' | 'sleep' | 'social' | 'context';

export interface Indicator {
  key: string;
  label: string;
}

export interface Dimension {
  key: DimensionKey;
  label: string;
  indicators: Indicator[];
}

export const DIMENSIONS: Dimension[] = [
  { key: 'mood', label: 'Humor', indicators: [
    { key: 'tristeza', label: 'Tristeza' },
    { key: 'alegria', label: 'Alegria' },
    { key: 'euforia', label: 'Euforia' },
    { key: 'apatia', label: 'Apatia' },
    { key: 'irritabilidade', label: 'Irritabilidade' },
    { key: 'estabilidade_emocional', label: 'Estabilidade emocional' },
  ]},
  { key: 'energy', label: 'Energia e ativação', indicators: [
    { key: 'energia_fisica', label: 'Energia física' },
    { key: 'energia_mental', label: 'Energia mental' },
    { key: 'agitacao_interna', label: 'Agitação interna' },
    { key: 'hiperatividade', label: 'Hiperatividade' },
    { key: 'necessidade_movimento', label: 'Necessidade de movimento' },
    { key: 'necessidade_estimulos', label: 'Necessidade de estímulos' },
  ]},
  { key: 'cognition', label: 'Estado cognitivo', indicators: [
    { key: 'velocidade_pensamentos', label: 'Velocidade dos pensamentos' },
    { key: 'concentracao', label: 'Concentração' },
    { key: 'clareza_mental', label: 'Clareza mental' },
    { key: 'ruminacao', label: 'Ruminação' },
    { key: 'pensamentos_acelerados', label: 'Pensamentos acelerados' },
    { key: 'capacidade_organizacao', label: 'Capacidade de organização' },
  ]},
  { key: 'anxiety', label: 'Ansiedade e tensão', indicators: [
    { key: 'preocupacao', label: 'Preocupação' },
    { key: 'tensao_fisica', label: 'Tensão física' },
    { key: 'inquietacao', label: 'Inquietação' },
    { key: 'medo', label: 'Medo' },
    { key: 'sensacao_urgencia', label: 'Sensação de urgência' },
    { key: 'sintomas_fisicos', label: 'Sintomas físicos' },
  ]},
  { key: 'impulsivity', label: 'Impulsividade e compulsividade', indicators: [
    { key: 'busca_estimulos', label: 'Necessidade de buscar estímulos' },
    { key: 'dificuldade_interromper', label: 'Dificuldade de interromper comportamentos' },
    { key: 'busca_recompensas_imediatas', label: 'Busca por recompensas imediatas' },
    { key: 'comportamentos_repetitivos', label: 'Comportamentos repetitivos' },
    { key: 'controle_impulsos', label: 'Controle dos impulsos' },
  ]},
  { key: 'sleep', label: 'Sono e recuperação', indicators: [
    // "Horas dormidas" é um campo numérico próprio (daily_entry.sleep_hours).
    { key: 'qualidade_sono', label: 'Qualidade do sono' },
    { key: 'facilidade_dormir', label: 'Facilidade para dormir' },
    { key: 'despertares_noturnos', label: 'Despertares noturnos' },
    { key: 'descanso_ao_acordar', label: 'Sensação de descanso ao acordar' },
  ]},
  { key: 'social', label: 'Comportamento e sociabilidade', indicators: [
    { key: 'vontade_socializar', label: 'Vontade de socializar' },
    { key: 'isolamento', label: 'Isolamento' },
    { key: 'comunicacao', label: 'Comunicação' },
    { key: 'produtividade', label: 'Produtividade' },
    { key: 'motivacao', label: 'Motivação' },
    { key: 'necessidade_interacao', label: 'Necessidade de interação' },
  ]},
  { key: 'context', label: 'Contexto e acontecimentos', indicators: [
    { key: 'situacoes_mudanca_emocional', label: 'Situações que provocaram mudanças emocionais' },
    { key: 'frustracoes', label: 'Frustrações' },
    { key: 'conflitos', label: 'Conflitos' },
    { key: 'atividades_prazerosas', label: 'Atividades prazerosas' },
    { key: 'exercicios_fisicos', label: 'Exercícios físicos' },
    { key: 'mudancas_rotina', label: 'Mudanças na rotina' },
  ]},
];

export const ALL_INDICATORS: Indicator[] = DIMENSIONS.flatMap(d => d.indicators);
export const INDICATOR_KEYS: string[] = ALL_INDICATORS.map(i => i.key);
export const INDICATOR_LABEL: Record<string, string> = Object.fromEntries(
  ALL_INDICATORS.map(i => [i.key, i.label]),
);
