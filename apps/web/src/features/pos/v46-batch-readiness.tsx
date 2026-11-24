export function SaleReadinessBadge({
  value,
}: {
  value: "BELUM_SIAP" | "SIAP_JUAL";
}) {
  const ready = value === "SIAP_JUAL";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
        ready ? "bg-[#eff8ed] text-[#347c2c]" : "bg-[#fff7ed] text-[#9a4f05]"
      }`}
    >
      {ready ? "SIAP_JUAL" : "BELUM_SIAP"}
    </span>
  );
}
