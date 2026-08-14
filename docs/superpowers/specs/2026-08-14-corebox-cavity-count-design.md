# Corebox Cavity Count Design

## Goal

Add an independent cavity-count field to the corebox master so each corebox records how many cavities it physically contains.

## Business Rules

- `CoreBoxMaster.cavityCount` is a required positive integer with database default `1`.
- Existing corebox records receive `1` when the schema is synchronized.
- A mold's `cavityCount` and a corebox's `cavityCount` are independent. Different coreboxes under one mold may have different values.
- BOM `quantityPerProduct` remains the core quantity ratio: the number of cores required for one product. It must not be derived from or replaced by the corebox cavity count.
- Future core-making capacity calculations may use both values, but this change does not add a production-capacity formula.

## Data And API

- Add `cavityCount Int @default(1)` to `CoreBoxMaster` in Prisma.
- Mold nested `coreBoxes[]` create/update requests accept `cavityCount`.
- Independent corebox create/update requests accept `cavityCount`.
- Modeling list/detail DTOs return `cavityCount` for both nested and independent corebox records.
- The API rejects zero, negative, decimal, or non-numeric cavity counts with a clear business error.
- Legacy requests that omit `cavityCount` save it as `1`.

## Admin UI

- Add “穴数” to the compact corebox rows in the mold archive form.
- Add “穴数” to the independent corebox archive list and create/view/edit form.
- Use `InputNumber` with integer precision, minimum `1`, and initial value `1`.
- Keep the compact mold/corebox layout and existing permission behavior unchanged.

## Testing

- API integration: create multiple coreboxes with different cavity counts, update one, and verify persistence and DTO values.
- Legacy API compatibility: omit cavity count and verify it defaults to `1`.
- Validation: reject `0`, negative values, decimals, and non-numeric values.
- Admin regression: assert both nested and independent corebox interfaces expose the field.
- Run Prisma validation/generation, API build, admin tests/build, and Docker API regression.

## Documentation

Update the production-modeling context and test-case files to distinguish corebox cavity count from BOM core quantity ratio.
