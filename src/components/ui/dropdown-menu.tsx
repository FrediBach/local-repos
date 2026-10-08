import * as React from 'react'
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'

export const DropdownMenu = DropdownPrimitive.Root
export const DropdownMenuTrigger = DropdownPrimitive.Trigger
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return <DropdownPrimitive.Portal><DropdownPrimitive.Content sideOffset={sideOffset} className={cn('dropdown-content', className)} {...props} /></DropdownPrimitive.Portal>
}
export function DropdownMenuItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item>) {
  return <DropdownPrimitive.Item className={cn('dropdown-item', className)} {...props} />
}
export function DropdownMenuCheckboxItem({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.CheckboxItem>) {
  return <DropdownPrimitive.CheckboxItem className={cn('dropdown-item dropdown-checkbox-item', className)} {...props}><span className="dropdown-checkbox-indicator"><DropdownPrimitive.ItemIndicator><Check size={14} /></DropdownPrimitive.ItemIndicator></span>{children}</DropdownPrimitive.CheckboxItem>
}
