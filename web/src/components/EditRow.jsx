import { useState } from 'preact/hooks';
import { useMutation } from '../hooks.js';
import { ErrorMessage, Field, Icon } from './ui.jsx';

// One past operation inside an "Editar" dialog: a one-line summary that
// turns into a small form. fields: [{ key, label, type?, initial }]
// save(values) → Promise (the API call). Errors are shown inline.
export function EditRow({ badge, summary, fields, save }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.key, f.initial])));
  const { run, busy, error } = useMutation();

  async function submit(e) {
    e.preventDefault();
    const { ok } = await run(() => save(values));
    if (ok) setEditing(false);
  }

  return (
    <li class="edit-row">
      <div class="edit-row-head">
        {badge}
        <span class="edit-row-summary">{summary}</span>
        {!editing && (
          <button type="button" class="icon-btn sm" aria-label="Editar esta operación" title="Editar" onClick={() => setEditing(true)}>
            <Icon name="edit" />
          </button>
        )}
      </div>
      {editing && (
        <form class="edit-form" onSubmit={submit}>
          <div class="edit-fields">
            {fields.map((f) => (
              <Field label={f.label}>
                <input
                  type={f.type ?? 'text'}
                  inputMode={f.type ? undefined : 'decimal'}
                  value={values[f.key]}
                  onInput={(e) => setValues((v) => ({ ...v, [f.key]: e.currentTarget.value }))}
                  autocomplete="off"
                  required={!f.optional}
                />
              </Field>
            ))}
          </div>
          <ErrorMessage>{error}</ErrorMessage>
          <div class="form-actions">
            <button type="button" class="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>
              Cancelar
            </button>
            <button type="submit" class="btn btn-primary btn-sm" disabled={busy}>
              Guardar
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export const CORRECTION_NOTE =
  'Corrige datos cargados mal, como si siempre hubieran sido así: no crea operaciones nuevas en el historial y corrige también el gráfico de crecimiento.';
