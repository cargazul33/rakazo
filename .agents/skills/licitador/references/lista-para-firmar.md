# LISTA PARA FIRMAR — plantilla obligatoria

Usá esta plantilla como resumen final de cada licitación. No marques `LISTA PARA FIRMAR` si existe un bloqueo material sin resolver.

## 1. Identificación

| Campo | Valor |
|---|---|
| Organismo | |
| Dependencia | |
| Expediente / proceso | |
| Objeto | |
| Fuente | |
| URL original | |
| Fecha y hora de cierre | |
| Lugar / modalidad de presentación | |
| Lugar de entrega | |
| Plazo de entrega | |
| Mantenimiento de oferta | |
| Condiciones de pago | |
| Estado | `LISTA PARA FIRMAR` |

## 2. Resultado económico interno

> Esta sección es interna. No incluirla en documentación destinada al organismo salvo exigencia expresa del pliego.

| Métrica | Valor |
|---|---:|
| Costo real puesto total | |
| Multiplicador comercial | **1,90** |
| Oferta total | |
| Diferencia compra/venta | |
| Cantidad de renglones | |
| Renglones con match exacto | |
| Renglones con equivalente válido | |
| Renglones con stock confirmado | |
| Renglones con riesgo aceptado | |

Verificación obligatoria:

```text
OFERTA_TOTAL = suma(costo_real_puesto_renglon × 1.90)
```

Registrar cualquier regla de IVA/impuestos exigida por el pliego sin ocultar ni reemplazar la fórmula base de costo × 1,90.

## 3. Matriz de renglones

| Renglón | Cant. | Requisito / producto | Producto seleccionado | Match | Proveedor | País | Costo real puesto unit. | Oferta unit. (= costo × 1,90) | Oferta renglón | Stock | Entrega | Evidencia |
|---|---:|---|---|---|---|---|---:|---:|---:|---|---|---|
| | | | | | | | | | | | | |

Valores permitidos para `Match`:

- `MATCH_EXACTO`
- `EQUIVALENTE_VALIDO`
- `NO_CUMPLE`
- `NO_VERIFICABLE`

Un expediente con `NO_CUMPLE` o `NO_VERIFICABLE` material no puede quedar `LISTA PARA FIRMAR`.

## 4. Proveedores seleccionados

| Proveedor | País | Renglones | Total compra estimado | Stock | Plazo | Link / evidencia | Riesgo |
|---|---|---|---:|---|---|---|---|
| | | | | | | | |

Indicar si la selección concentra compras para reducir complejidad logística y si existe una opción de respaldo.

## 5. Documentación para presentar

Marcar cada archivo/documento:

- [ ] Oferta/presupuesto económico completo.
- [ ] Planilla de renglones completa.
- [ ] Fichas técnicas requeridas.
- [ ] Formularios del organismo completos.
- [ ] Declaraciones requeridas preparadas.
- [ ] Garantías/documentación técnica requeridas.
- [ ] Constancias administrativas requeridas disponibles.
- [ ] Circulares/aclaraciones incorporadas.
- [ ] Archivos revisados para no incluir costos internos ni datos de proveedores de compra que no correspondan.
- [ ] Sólo quedan pendientes firma/sello/subida del usuario, si aplica.

## 6. Auditoría técnica

| Control | Resultado | Evidencia / observación |
|---|---|---|
| Todos los renglones incluidos | | |
| Cantidades y unidades coinciden | | |
| Marca/modelo exactos cuando son obligatorios | | |
| Equivalencias permitidas y justificadas | | |
| Especificaciones obligatorias verificadas | | |
| Stock/cantidad suficientes | | |
| Plazo compatible | | |
| Fichas y links corresponden al producto | | |

Resultado auditoría técnica: **APROBADA / NO APROBADA**

## 7. Auditoría económica

| Control | Resultado | Evidencia / observación |
|---|---|---|
| Todos los costos tienen fuente | | |
| Tipo de cambio tiene fuente y fecha | | |
| Costos logísticos/importación trazables | | |
| Cantidades recalculadas | | |
| Costo real puesto recalculado | | |
| Multiplicador 1,90 aplicado en todos los renglones | | |
| Totales y redondeos recalculados independientemente | | |

Resultado auditoría económica: **APROBADA / NO APROBADA**

## 8. Riesgos y pendientes

Listar únicamente riesgos reales y acciones pendientes. No esconder incertidumbres detrás de lenguaje genérico.

| Riesgo / pendiente | Impacto | Acción necesaria | Bloquea firma |
|---|---|---|---|
| | | | Sí/No |

Si `Bloquea firma = Sí`, el estado debe volver a `RIESGO` o `COTIZANDO`.

## 9. Acción requerida del usuario

Si ambas auditorías están aprobadas y no hay bloqueos:

```text
ESTADO: LISTA PARA FIRMAR
ACCIÓN HUMANA: REVISAR → FIRMAR → SUBIR
```

Nunca firmar, falsificar firmas/sellos, realizar la presentación definitiva ni confirmar pagos sin autorización explícita.

## 10. Si resulta GANADA

Preparar una nueva hoja interna con:

| Renglón | Producto | Proveedor | Cantidad | Precio actual | Stock revalidado | Link de compra | Total | Cambio vs. cotización |
|---|---|---|---:|---:|---|---|---:|---|
| | | | | | | | | |

Detenerse antes del pago y solicitar aprobación explícita para la compra.