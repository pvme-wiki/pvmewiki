import { StateEffect, StateField } from "@codemirror/state";
import { history, invertedEffects } from "@codemirror/commands";
import { mapWritingFields } from "./writing-projection.mjs";
const restoreLayout = StateEffect.define();
export function createWritingHistory(initial) {
  function positionsFor(transaction) {
    const prior = transaction.startState.field(positions);
    const restored = transaction.effects
      .filter((effect) => effect.is(restoreLayout))
      .at(-1);
    return restored
      ? {
          source: transaction.newDoc.toString(),
          fields: structuredClone(restored.value),
        }
      : mapWritingFields(prior, transaction.changes);
  }
  const positions = StateField.define({
    create: () => initial,
    update: (value, transaction) =>
      transaction.docChanged ? positionsFor(transaction) : value,
  });
  return {
    positions,
    positionsFor,
    extensions: [
      positions,
      history(),
      invertedEffects.of((transaction) =>
        transaction.docChanged
          ? [
              restoreLayout.of(
                structuredClone(transaction.startState.field(positions).fields),
              ),
            ]
          : [],
      ),
    ],
  };
}
