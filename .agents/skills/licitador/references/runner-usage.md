# LICITADOR runner — uso operativo

El runner persiste el estado en `/home/rakazo/licitador/state.json` y separa cada licitación en `/home/rakazo/licitador/jobs/<job_id>/`.

## Instalación dentro de la computadora del bot

```bash
mkdir -p /home/rakazo/licitador
curl -fsSL https://raw.githubusercontent.com/cargazul33/rakazo/main/.agents/skills/licitador/runner.py -o /home/rakazo/licitador/runner.py
chmod +x /home/rakazo/licitador/runner.py
python3 /home/rakazo/licitador/runner.py init
```

## Recuperación luego de un corte

```bash
python3 /home/rakazo/licitador/runner.py resume
```

Nunca reiniciar una licitación desde cero si existe `state.json` y un job actual.
