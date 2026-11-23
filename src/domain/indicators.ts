// Catálogo de indicadores. Espelha a tabela indicator_def do banco.
// Qualquer alteração aqui exige migração correspondente.
// As chaves e os valores numéricos são estáveis para preservar o histórico.
// Cada indicador explicita seus próprios extremos; não se deve presumir uma polaridade única.

export type ScaleKind = 'intensidade' | 'capacidade' | 'qualidade' | 'frequencia';

export type DimensionKey =
  | 'mood' | 'energy' | 'cognition' | 'anxiety'
  | 'impulsivity' | 'sleep' | 'social' | 'context';

export interface Indicator {
  key: string;
  label: string;
  scaleKind: ScaleKind;
  scaleLow: string;
  scaleHigh: string;
}

export interface Dimension {
  key: DimensionKey;
  label: string;
  indicators: Indicator[];
}

export const DIMENSIONS: Dimension[] = [
  { key: 'mood', label: 'Humor', indicators: [
    { key: 'tristeza', label: 'Tristeza', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'alegria', label: 'Alegria', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'euforia', label: 'Euforia', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'apatia', label: 'Apatia', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'irritabilidade', label: 'Irritabilidade', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'estabilidade_emocional', label: 'Estabilidade emocional', scaleKind: 'capacidade', scaleLow: 'Muito baixa', scaleHigh: 'Muito alta' },
  ]},
  { key: 'energy', label: 'Energia e ativação', indicators: [
    { key: 'energia_fisica', label: 'Energia física', scaleKind: 'intensidade', scaleLow: 'Muito baixa', scaleHigh: 'Muito alta' },
    { key: 'energia_mental', label: 'Energia mental', scaleKind: 'intensidade', scaleLow: 'Muito baixa', scaleHigh: 'Muito alta' },
    { key: 'agitacao_interna', label: 'Agitação interna', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'hiperatividade', label: 'Hiperatividade', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'necessidade_movimento', label: 'Necessidade de movimento', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'necessidade_estimulos', label: 'Necessidade de estímulos', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
  ]},
  { key: 'cognition', label: 'Estado cognitivo', indicators: [
    { key: 'velocidade_pensamentos', label: 'Velocidade dos pensamentos', scaleKind: 'intensidade', scaleLow: 'Muito lenta', scaleHigh: 'Muito acelerada' },
    { key: 'concentracao', label: 'Concentração', scaleKind: 'capacidade', scaleLow: 'Muito baixa', scaleHigh: 'Muito alta' },
    { key: 'clareza_mental', label: 'Clareza mental', scaleKind: 'capacidade', scaleLow: 'Muito baixa', scaleHigh: 'Muito alta' },
    { key: 'ruminacao', label: 'Ruminação', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'pensamentos_acelerados', label: 'Pensamentos acelerados', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensos' },
    { key: 'capacidade_organizacao', label: 'Capacidade de organização', scaleKind: 'capacidade', scaleLow: 'Muito baixa', scaleHigh: 'Muito alta' },
  ]},
  { key: 'anxiety', label: 'Ansiedade e tensão', indicators: [
    { key: 'preocupacao', label: 'Preocupação', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'tensao_fisica', label: 'Tensão física', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'inquietacao', label: 'Inquietação', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'medo', label: 'Medo', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intenso' },
    { key: 'sensacao_urgencia', label: 'Sensação de urgência', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'sintomas_fisicos', label: 'Sintomas físicos', scaleKind: 'intensidade', scaleLow: 'Ausentes', scaleHigh: 'Muito intensos' },
  ]},
  { key: 'impulsivity', label: 'Impulsividade e compulsividade', indicators: [
    { key: 'busca_estimulos', label: 'Necessidade de buscar estímulos', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'dificuldade_interromper', label: 'Dificuldade de interromper comportamentos', scaleKind: 'intensidade', scaleLow: 'Nenhuma dificuldade', scaleHigh: 'Dificuldade extrema' },
    { key: 'busca_recompensas_imediatas', label: 'Busca por recompensas imediatas', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'comportamentos_repetitivos', label: 'Comportamentos repetitivos', scaleKind: 'frequencia', scaleLow: 'Nenhuma ocorrência', scaleHigh: 'Muito frequentes' },
    { key: 'controle_impulsos', label: 'Controle dos impulsos', scaleKind: 'capacidade', scaleLow: 'Muito baixo', scaleHigh: 'Muito alto' },
  ]},
  { key: 'sleep', label: 'Sono e recuperação', indicators: [
    // "Horas dormidas" é um campo numérico próprio (daily_entry.sleep_hours).
    { key: 'qualidade_sono', label: 'Qualidade do sono', scaleKind: 'qualidade', scaleLow: 'Muito ruim', scaleHigh: 'Excelente' },
    { key: 'facilidade_dormir', label: 'Facilidade para dormir', scaleKind: 'qualidade', scaleLow: 'Muito difícil', scaleHigh: 'Muito fácil' },
    { key: 'despertares_noturnos', label: 'Despertares noturnos', scaleKind: 'frequencia', scaleLow: 'Nenhum', scaleHigh: 'Muito frequentes' },
    { key: 'descanso_ao_acordar', label: 'Sensação de descanso ao acordar', scaleKind: 'qualidade', scaleLow: 'Nada descansado', scaleHigh: 'Muito descansado' },
  ]},
  { key: 'social', label: 'Comportamento e sociabilidade', indicators: [
    { key: 'vontade_socializar', label: 'Vontade de socializar', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'isolamento', label: 'Isolamento', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intenso' },
    { key: 'comunicacao', label: 'Comunicação', scaleKind: 'capacidade', scaleLow: 'Muito baixa', scaleHigh: 'Muito alta' },
    { key: 'produtividade', label: 'Produtividade', scaleKind: 'capacidade', scaleLow: 'Muito baixa', scaleHigh: 'Muito alta' },
    { key: 'motivacao', label: 'Motivação', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
    { key: 'necessidade_interacao', label: 'Necessidade de interação', scaleKind: 'intensidade', scaleLow: 'Ausente', scaleHigh: 'Muito intensa' },
  ]},
  { key: 'context', label: 'Contexto e acontecimentos', indicators: [
    { key: 'situacoes_mudanca_emocional', label: 'Situações que provocaram mudanças emocionais', scaleKind: 'frequencia', scaleLow: 'Nenhuma ocorrência', scaleHigh: 'Muitas ocorrências' },
    { key: 'frustracoes', label: 'Frustrações', scaleKind: 'intensidade', scaleLow: 'Ausentes', scaleHigh: 'Muito intensas' },
    { key: 'conflitos', label: 'Conflitos', scaleKind: 'frequencia', scaleLow: 'Nenhuma ocorrência', scaleHigh: 'Muitas ocorrências' },
    { key: 'atividades_prazerosas', label: 'Atividades prazerosas', scaleKind: 'frequencia', scaleLow: 'Nenhuma ocorrência', scaleHigh: 'Muitas ocorrências' },
    { key: 'exercicios_fisicos', label: 'Exercícios físicos', scaleKind: 'frequencia', scaleLow: 'Nenhuma ocorrência', scaleHigh: 'Muitas ocorrências' },
    { key: 'mudancas_rotina', label: 'Mudanças na rotina', scaleKind: 'frequencia', scaleLow: 'Nenhuma ocorrência', scaleHigh: 'Muitas ocorrências' },
  ]},
];

export const ALL_INDICATORS: Indicator[] = DIMENSIONS.flatMap(d => d.indicators);
export const INDICATOR_KEYS: string[] = ALL_INDICATORS.map(i => i.key);
export const INDICATOR_LABEL: Record<string, string> = Object.fromEntries(
  ALL_INDICATORS.map(i => [i.key, i.label]),
);
