/**
 * Settings panel UI component.
 *
 * Global parameters: time period, winter period, percentile, snow threshold.
 * API key management.
 */

export function createSettingsPanel(state) {
  return {
    name: 'Settings',
    icon: '⚙',

    render(container, { onSettingChange }) {
      container.innerHTML = '';

      const settings = [
        {
          key: 'timePeriod',
          label: 'Time period (years)',
          value: state.globalParams.timePeriod,
          type: 'number',
          min: 1,
          max: 60,
        },
        {
          key: 'winterStart',
          label: 'Winter start',
          value: state.globalParams.winterStart,
          type: 'text',
          placeholder: 'MM-DD',
        },
        {
          key: 'winterEnd',
          label: 'Winter end',
          value: state.globalParams.winterEnd,
          type: 'text',
          placeholder: 'MM-DD',
        },
        {
          key: 'percentile',
          label: 'Percentile',
          value: state.globalParams.percentile,
          type: 'number',
          min: 1,
          max: 99,
        },
        {
          key: 'snowThreshold',
          label: 'Snow threshold (cm)',
          value: state.globalParams.snowThreshold,
          type: 'select',
          options: [5, 10, 15, 20],
        },
      ];

      for (const setting of settings) {
        const row = document.createElement('div');
        row.className = 'setting-row';

        const label = document.createElement('span');
        label.className = 'setting-label';
        label.textContent = setting.label;
        row.appendChild(label);

        if (setting.type === 'select') {
          const select = document.createElement('select');
          select.className = 'setting-input';
          select.style.width = 'auto';
          for (const opt of setting.options) {
            const option = document.createElement('option');
            option.value = opt;
            option.textContent = `${opt}`;
            if (opt === setting.value) option.selected = true;
            select.appendChild(option);
          }
          select.addEventListener('change', () => {
            onSettingChange(setting.key, parseInt(select.value));
          });
          row.appendChild(select);
        } else {
          const valueSpan = document.createElement('span');
          valueSpan.className = 'setting-value';
          valueSpan.textContent = setting.value;

          let editing = false;
          valueSpan.addEventListener('click', () => {
            if (editing) return;
            editing = true;

            const input = document.createElement('input');
            input.className = 'setting-input';
            input.type = setting.type;
            input.value = setting.value;
            if (setting.min !== undefined) input.min = setting.min;
            if (setting.max !== undefined) input.max = setting.max;
            if (setting.placeholder) input.placeholder = setting.placeholder;

            row.replaceChild(input, valueSpan);
            input.focus();
            input.select();

            const commit = () => {
              const newVal = setting.type === 'number' ? parseInt(input.value) : input.value;
              if (newVal !== setting.value) {
                setting.value = newVal;
                valueSpan.textContent = newVal;
                onSettingChange(setting.key, newVal);
              }
              row.replaceChild(valueSpan, input);
              editing = false;
            };

            input.addEventListener('blur', commit);
            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                row.replaceChild(valueSpan, input);
                editing = false;
              }
            });
          });

          row.appendChild(valueSpan);
        }

        container.appendChild(row);
      }
    },
  };
}

export function createKeysPanel(state) {
  return {
    name: 'API Keys',
    icon: '🔑',

    render(container, { onKeyAction }) {
      container.innerHTML = '';

      const keys = [
        { id: 'lantmateriet', label: 'Lantmäteriet token' },
        { id: 'openrouteservice', label: 'OpenRouteService key' },
      ];

      for (const key of keys) {
        const row = document.createElement('div');
        row.className = 'setting-row';

        const label = document.createElement('span');
        label.className = 'setting-label';
        label.textContent = key.label;
        row.appendChild(label);

        const isSet = state.keyStatus[key.id];

        const status = document.createElement('span');
        status.className = `key-status ${isSet ? 'set' : 'missing'}`;
        status.textContent = isSet ? 'Set' : 'Missing';
        row.appendChild(status);

        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = isSet ? 'Update' : 'Set';
        btn.style.marginLeft = '8px';
        btn.addEventListener('click', () => {
          onKeyAction(key.id);
        });
        row.appendChild(btn);

        container.appendChild(row);
      }
    },
  };
}
