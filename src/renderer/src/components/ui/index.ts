// UI primitives barrel — PRD 6.1 core atoms.
// Re-exports existing button/card primitives plus the new lightweight atoms.

export { Button, buttonVariants, type ButtonProps } from "./button";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./card";

export { Input, type InputProps, type InputVariant, type InputSize, type InputType } from "./input";
export { Toggle, type ToggleProps } from "./toggle";
export { Badge, type BadgeProps, type BadgeVariant } from "./badge";
export { Spinner, type SpinnerProps, type SpinnerSize } from "./spinner";
export { Skeleton, type SkeletonProps } from "./skeleton";
export { Tooltip, type TooltipProps } from "./tooltip";
export { Divider, type DividerProps, type DividerOrientation } from "./divider";
