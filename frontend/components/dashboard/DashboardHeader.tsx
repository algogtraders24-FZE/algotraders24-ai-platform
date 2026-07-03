export default function DashboardHeader({ userName }: { userName: string }) {
  return (
    <header className="flex items-center justify-between border-b border-[#1F2937] px-6 py-4">
      <div className="text-sm text-gray-400">Welcome back</div>
      <div className="flex items-center gap-3">
        <span className="text-sm">{userName}</span>
        <div className="w-9 h-9 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center font-bold">
          {userName.charAt(0)}
        </div>
      </div>
    </header>
  );
}