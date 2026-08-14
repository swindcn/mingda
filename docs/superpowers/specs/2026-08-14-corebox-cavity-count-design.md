# Corebox Cavity Count And BOM Shelf Life Design

## Goal

Add an independent cavity-count field to the corebox master and a BOM-specific shelf-life field for each selected corebox.

## Business Rules

- `CoreBoxMaster.cavityCount` is a required positive integer with database default `1`.
- Existing corebox records receive `1` when the schema is synchronized.
- A mold's `cavityCount` and a corebox's `cavityCount` are independent. Different coreboxes under one mold may have different values.
- BOM `quantityPerProduct` remains the core quantity ratio: the number of cores required for one product. It must not be derived from or replaced by the corebox cavity count.
- BOM corebox `shelfLifeHours` records the allowed shelf life in hours for the core used by that BOM version. It belongs to the BOM/corebox relation, not `CoreBoxMaster`.
- `shelfLifeHours` is optional, supports decimal hours such as `2.5`, and must be greater than `0` when provided. Missing values remain `null`, not `0`.
- Future core-making capacity calculations may use both values, but this change does not add a production-capacity formula.

## Data And API

- Add `cavityCount Int @default(1)` to `CoreBoxMaster` in Prisma.
- Add nullable `shelfLifeHours Decimal @db.Decimal(12, 4)` to `CastingBomVersionCoreBox`.
- Mold nested `coreBoxes[]` create/update requests accept `cavityCount`.
- Independent corebox create/update requests accept `cavityCount`.
- Modeling list/detail DTOs return `cavityCount` for both nested and independent corebox records.
- The API rejects zero, negative, decimal, or non-numeric cavity counts with a clear business error.
- Legacy requests that omit `cavityCount` save it as `1`.
- Structured BOM `coreBoxes[]` requests accept `shelfLifeHours`; legacy `coreBoxCodes[]` requests keep it empty.
- BOM detail, new-version, clone, and calculation responses preserve and return `shelfLifeHours`.

## Admin UI

- Add “穴数” to the compact corebox rows in the mold archive form.
- Add “穴数” to the independent corebox archive list and create/view/edit form.
- Use `InputNumber` with integer precision, minimum `1`, and initial value `1`.
- Add “保质期（小时）” beside “芯件比” in the BOM corebox detail rows. Use a decimal `InputNumber`; leave it empty when unknown.
- Keep the compact mold/corebox layout and existing permission behavior unchanged.

## Testing

- API integration: create multiple coreboxes with different cavity counts, update one, and verify persistence and DTO values.
- Legacy API compatibility: omit cavity count and verify it defaults to `1`.
- Cavity-count validation: reject `0`, negative values, decimals, and non-numeric values.
- BOM integration: save decimal shelf life, preserve it across new versions, return it from calculations, and reject non-positive values.
- Admin regression: assert both nested and independent corebox interfaces expose the field.
- Run Prisma validation/generation, API build, admin tests/build, and Docker API regression.

## Documentation

Update the production-modeling context and test-case files to distinguish corebox cavity count, BOM core quantity ratio, and BOM core shelf life.
