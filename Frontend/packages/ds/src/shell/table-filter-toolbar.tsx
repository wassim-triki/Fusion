"use client";

import type { ReactNode } from "react";
import { ListFilter } from "../icons";
import { Button } from "../components/ui/button";

interface TableFilterToolbarProps {
  search: ReactNode;
  primaryFilters?: ReactNode;
  secondaryFilters?: ReactNode;
  showAdvancedToggle?: boolean;
  isAdvancedOpen?: boolean;
  isAdvancedActive?: boolean;
  onAdvancedToggle?: () => void;
  clearAction?: ReactNode;
}

export function TableFilterToolbar({
  search,
  primaryFilters,
  secondaryFilters,
  showAdvancedToggle = false,
  isAdvancedOpen = false,
  isAdvancedActive = false,
  onAdvancedToggle,
  clearAction,
}: TableFilterToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {search}
      {primaryFilters}

      {showAdvancedToggle && secondaryFilters ? (
        <>
          <Button
            variant={isAdvancedOpen || isAdvancedActive ? "secondary" : "ghost"}
            size="sm"
            className="gap-1 text-muted-foreground"
            onClick={onAdvancedToggle}
          >
            <ListFilter className="size-3.5" />
            Advanced
          </Button>

          {isAdvancedOpen ? secondaryFilters : null}
        </>
      ) : null}

      {clearAction}
    </div>
  );
}
