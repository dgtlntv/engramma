import { z } from "zod";

const ColorValueSchema = z.object({
  colorSpace: z.string(),
  components: z.array(z.number()),
});

export const ColorSchema = z.object({
  type: z.literal("color"),
  value: ColorValueSchema,
});

const DimensionValueSchema = z.object({
  value: z.number(),
  unit: z.enum(["px", "rem"]),
});

export const DimensionSchema = z.object({
  type: z.literal("dimension"),
  value: DimensionValueSchema,
});

const DurationValueSchema = z.object({
  value: z.number(),
  unit: z.enum(["ms", "s"]),
});

export const DurationSchema = z.object({
  type: z.literal("duration"),
  value: DurationValueSchema,
});

export const NumberSchema = z.object({
  type: z.literal("number"),
  value: z.number(),
});

const CubicBezierValueSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine(
    ([x1, , x2]) => x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1,
    "Cubic bezier x-coordinates must be between 0 and 1",
  );

export const CubicBezierSchema = z.object({
  type: z.literal("cubicBezier"),
  value: CubicBezierValueSchema,
});

const FontFamilyValueSchema = z.union([z.string(), z.array(z.string())]);

export const FontFamilySchema = z.object({
  type: z.literal("fontFamily"),
  value: FontFamilyValueSchema,
});

const FontWeightValueSchema = z.union([z.number(), z.string()]);

export const FontWeightSchema = z.object({
  type: z.literal("fontWeight"),
  value: FontWeightValueSchema,
});

export const TransitionSchema = z.object({
  type: z.literal("transition"),
  value: z.object({
    duration: DurationValueSchema,
    delay: DurationValueSchema,
    timingFunction: CubicBezierValueSchema,
  }),
});

const StrokeStyleValueSchema = z.union([
  z.literal("solid"),
  z.literal("dashed"),
  z.literal("dotted"),
  z.literal("double"),
  z.literal("groove"),
  z.literal("ridge"),
  z.literal("outset"),
  z.literal("inset"),
  z.object({
    dashArray: z.array(DimensionValueSchema),
    lineCap: z.union([
      z.literal("round"),
      z.literal("butt"),
      z.literal("square"),
    ]),
  }),
]);

export const StrokeStyleSchema = z.object({
  type: z.literal("strokeStyle"),
  value: StrokeStyleValueSchema,
});

const ShadowItemSchema = z.object({
  color: ColorValueSchema,
  offsetX: DimensionValueSchema,
  offsetY: DimensionValueSchema,
  blur: DimensionValueSchema,
  spread: DimensionValueSchema.optional(),
  inset: z.boolean().optional(),
});

export const ShadowSchema = z.object({
  type: z.literal("shadow"),
  value: z.union([ShadowItemSchema, z.array(ShadowItemSchema)]),
});

export const BorderSchema = z.object({
  type: z.literal("border"),
  value: z.object({
    color: ColorValueSchema,
    width: DimensionValueSchema,
    style: StrokeStyleValueSchema,
  }),
});

export const TypographySchema = z.object({
  type: z.literal("typography"),
  value: z.object({
    fontFamily: FontFamilyValueSchema,
    fontSize: DimensionValueSchema,
    fontWeight: FontWeightValueSchema,
    letterSpacing: DimensionValueSchema,
    lineHeight: z.number(),
  }),
});

const GradientStopSchema = z.object({
  color: ColorValueSchema,
  position: z.number().min(0).max(1),
});

export const GradientSchema = z.object({
  type: z.literal("gradient"),
  value: z.array(GradientStopSchema),
});

export const ValueSchema = z.union([
  ColorSchema,
  DimensionSchema,
  DurationSchema,
  CubicBezierSchema,
  NumberSchema,
  FontFamilySchema,
  FontWeightSchema,
  TransitionSchema,
  StrokeStyleSchema,
  ShadowSchema,
  BorderSchema,
  TypographySchema,
  GradientSchema,
]);

export type Value = z.infer<typeof ValueSchema>;
