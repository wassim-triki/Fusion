"use client";

import type { RowData } from "@tanstack/react-table";
import { Search, X } from "../icons";
import { useTranslations } from "next-intl";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../components/ui/input-group";
import { cn } from "../lib/utils";
import type { DataTableModel } from "./use-data-table";

/*
 * Every toolbar control is the same object: 32px tall, control radius, the same border. Search and
 * filter chips differ only in what they hold.
 */

export function DataTableSearch<TData extends RowData>({
  model,
  placeholder,
  label,
  className,
}: {
  model: DataTableModel<TData>;
  placeholder?: string;
  /** Accessible name; defaults to the placeholder without its ellipsis. */
  label?: string;
  className?: string;
}) {
  const t = useTranslations("ds.table");
  const { value, setValue } = model.search;
  const hint = placeholder ?? t("search");
  return (
    <InputGroup className={cn("w-full", className)}>
      <InputGroupAddon>
        <Search aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            setValue("");
          }
        }}
        placeholder={hint}
        aria-label={label ?? hint.replace(/…$/, "")}
        className="[&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={t("clearSearch")}
            onClick={() => setValue("")}
          >
            <X aria-hidden />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}
