/**
 * Fusion's one icon set: Hugeicons (stroke-rounded), under the names call sites use (D-78). The shell, Core HR,
 * Performance, Platform and the DS's own chrome import every glyph from here, so each choice lives once and can be
 * tuned without touching a call site. Names follow Lucide's where one existed, so a swap is an import change; each
 * export takes the same `className` sizing (`size-4`), `aria-hidden` and `strokeWidth` props.
 */
import { forwardRef, type ForwardRefExoticComponent, type RefAttributes } from "react";
import { HugeiconsIcon, type HugeiconsProps, type IconSvgElement } from "@hugeicons/react";
import {
  Activity01Icon,
  Add01Icon,
  AddCircleIcon,
  Agreement01Icon,
  AiBrain01Icon,
  Alert02Icon,
  AlertCircleIcon,
  Analytics01Icon,
  Archive02Icon,
  ArrowDataTransferHorizontalIcon,
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowLeft01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  FastForwardIcon,
  ArrowUp01Icon,
  ArrowUp02Icon,
  ArrowUpRight01Icon,
  AttachmentIcon,
  Award01Icon,
  BalanceScaleIcon,
  BirthdayCakeIcon,
  BookOpen01Icon,
  Bookmark02Icon,
  Briefcase01Icon,
  Building01Icon,
  Building03Icon,
  Building06Icon,
  Calendar03Icon,
  CalendarAdd01Icon,
  CalendarCheck01Icon,
  CalendarClockIcon,
  Call02Icon,
  Camera01Icon,
  Cancel01Icon,
  CancelCircleIcon,
  ChartBarIncreasingIcon,
  ChartColumnBigIcon,
  ChartColumnIcon,
  ChartHistogramIcon,
  ChartIncreaseIcon,
  ChartLineData01Icon,
  Chatting01Icon,
  CheckmarkCircle02Icon,
  CircleDashedIcon,
  Clapping01Icon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  Clock01Icon,
  CloudUploadIcon,
  Coffee02Icon,
  Comment01Icon,
  CompassIcon,
  ComputerIcon,
  Copy01Icon,
  CornerDownLeftIcon,
  CornerLeftUpIcon,
  CrosshairIcon,
  CrownIcon,
  DashboardSpeed02Icon,
  DashboardSquare01Icon,
  DashboardSquare02Icon,
  Delete02Icon,
  Download04Icon,
  DragDropVerticalIcon,
  Edit02Icon,
  FavouriteIcon,
  File01Icon,
  File02Icon,
  FileExportIcon,
  FileRemoveIcon,
  FileSpreadsheetIcon,
  FileValidationIcon,
  FilterHorizontalIcon,
  FingerPrintIcon,
  Flag02Icon,
  FloppyDiskIcon,
  FlowConnectionIcon,
  GiftIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  Globe02Icon,
  GoalIcon,
  GridViewIcon,
  HelpCircleIcon,
  HierarchyIcon,
  HierarchySquare01Icon,
  Home01Icon,
  HourglassIcon,
  Idea01Icon,
  Image01Icon,
  ImageUploadIcon,
  InboxIcon,
  InformationCircleIcon,
  KeyboardIcon,
  LanguageSkillIcon,
  Layers01Icon,
  LeftToRightListBulletIcon,
  Link02Icon,
  LinkSquare02Icon,
  ListViewIcon,
  Loading03Icon,
  Location01Icon,
  LockKeyIcon,
  Login01Icon,
  Logout01Icon,
  Mail01Icon,
  MailRemove01Icon,
  MailValidation01Icon,
  Maximize01Icon,
  Message01Icon,
  MessageAdd01Icon,
  MessageMultiple01Icon,
  MilestoneIcon,
  MinusSignCircleIcon,
  MinusSignIcon,
  Moon02Icon,
  MoreHorizontalIcon as MoreHorizontalGlyph,
  Note01Icon,
  Notification03Icon,
  PackageIcon,
  PaintBoardIcon,
  PartyIcon,
  PencilEdit01Icon,
  PencilEdit02Icon,
  PercentIcon,
  PieChart02Icon,
  PlayIcon,
  PowerOffIcon,
  Progress02Icon,
  QuoteDownIcon,
  RefreshIcon,
  Rocket01Icon,
  Route02Icon,
  RulerIcon,
  Search01Icon,
  SearchRemoveIcon,
  SentIcon,
  Settings02Icon,
  ShapesIcon,
  Share08Icon,
  Shield01Icon,
  ShieldAlertIcon,
  ShieldBanIcon,
  ShieldCheckIcon,
  SidebarLeftIcon,
  SigmaIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquareArrowRightEnterIcon,
  SquareIcon,
  SquareLock02Icon,
  StampIcon,
  StarIcon,
  Sun03Icon,
  Tag01Icon,
  Target02Icon,
  TaskDone01Icon,
  TextFontIcon,
  ThumbsUpIcon,
  Tick02Icon,
  TradeDownIcon,
  TradeUpIcon,
  TreePalmIcon,
  TriangleIcon,
  UnavailableIcon,
  Undo02Icon,
  UnfoldMoreIcon,
  Unlink02Icon,
  Upload04Icon,
  UserAdd01Icon,
  UserCheck01Icon,
  UserCircleIcon,
  UserEdit01Icon,
  UserGroupIcon,
  UserIcon,
  UserMinus01Icon,
  UserRemove01Icon,
  UserSearch01Icon,
  Video01Icon,
  ViewIcon,
  ViewOffSlashIcon,
  WorkflowSquare01Icon,
  WorkHistoryIcon,
  Wrench01Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
} from "@hugeicons/core-free-icons";

// `strokeWidth` also takes a string, as Lucide's did, so existing call sites keep compiling.
export type IconProps = Omit<HugeiconsProps, "icon" | "ref" | "altIcon" | "showAlt" | "strokeWidth"> & {
  strokeWidth?: number | string;
};
export type Icon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;

/** Hugeicons' 1.5 default reads thin beside Geist at 14–16px; 1.75 keeps the rounded style but holds weight. */
const STROKE = 1.75;

/** Icons that point along the line, mirrored right to left by the tokens' `data-rtl-flip` rule. */
const DIRECTIONAL = new Set(["ChevronRight", "ChevronLeft", "ArrowRight", "ArrowLeft", "Undo2", "FastForward"]);

function icon(svg: IconSvgElement, name: string): Icon {
  const flip = DIRECTIONAL.has(name) ? { "data-rtl-flip": "" } : {};
  const Component = forwardRef<SVGSVGElement, IconProps>(function FusionIcon({ strokeWidth = STROKE, ...props }, ref) {
    return <HugeiconsIcon ref={ref} icon={svg} strokeWidth={Number(strokeWidth)} {...flip} {...props} />;
  });
  Component.displayName = name;
  return Component;
}

// States and confirmation
export const Check = icon(Tick02Icon, "Check");
export const CheckIcon = Check;
export const CircleCheck = icon(CheckmarkCircle02Icon, "CircleCheck");
export const CheckCircle2 = CircleCheck;
export const CircleCheckIcon = CircleCheck;
export const X = icon(Cancel01Icon, "X");
export const XIcon = X;
export const CircleX = icon(CancelCircleIcon, "CircleX");
export const OctagonXIcon = CircleX;
export const Info = icon(InformationCircleIcon, "Info");
export const InfoIcon = Info;
export const TriangleAlert = icon(Alert02Icon, "TriangleAlert");
export const AlertTriangle = TriangleAlert;
export const TriangleAlertIcon = TriangleAlert;
export const CircleAlert = icon(AlertCircleIcon, "CircleAlert");
export const AlertCircle = CircleAlert;
export const Ban = icon(UnavailableIcon, "Ban");
export const CircleSlash = Ban;
export const Lock = icon(SquareLock02Icon, "Lock");
export const LockKeyhole = icon(LockKeyIcon, "LockKeyhole");
export const Shield = icon(Shield01Icon, "Shield");
export const ShieldCheck = icon(ShieldCheckIcon, "ShieldCheck");
export const ShieldAlert = icon(ShieldAlertIcon, "ShieldAlert");
export const ShieldOff = icon(ShieldBanIcon, "ShieldOff");
export const CircleDashed = icon(CircleDashedIcon, "CircleDashed");
export const CircleMinus = icon(MinusSignCircleIcon, "CircleMinus");
export const Loader2 = icon(Loading03Icon, "Loader2");
export const Loader2Icon = Loader2;
export const LoaderCircle = Loader2;
export const Hourglass = icon(HourglassIcon, "Hourglass");

// Navigation and direction
export const Archive = icon(Archive02Icon, "Archive");
export const ArrowDown = icon(ArrowDown02Icon, "ArrowDown");
export const ArrowUp = icon(ArrowUp02Icon, "ArrowUp");
export const ArrowRight = icon(ArrowRight02Icon, "ArrowRight");
export const ArrowLeft = icon(ArrowLeft02Icon, "ArrowLeft");
export const ArrowUpRight = icon(ArrowUpRight01Icon, "ArrowUpRight");
export const ArrowLeftRight = icon(ArrowDataTransferHorizontalIcon, "ArrowLeftRight");
export const ArrowRightLeft = ArrowLeftRight;
export const ChevronRight = icon(ArrowRight01Icon, "ChevronRight");
export const ChevronRightIcon = ChevronRight;
export const ChevronLeft = icon(ArrowLeft01Icon, "ChevronLeft");
export const ChevronLeftIcon = ChevronLeft;
export const ChevronDown = icon(ArrowDown01Icon, "ChevronDown");
export const ChevronDownIcon = ChevronDown;
export const ChevronUp = icon(ArrowUp01Icon, "ChevronUp");
export const ChevronUpIcon = ChevronUp;
export const ChevronsUpDown = icon(UnfoldMoreIcon, "ChevronsUpDown");
export const SquareArrowEnter = icon(SquareArrowRightEnterIcon, "SquareArrowEnter");
export const ExternalLink = icon(LinkSquare02Icon, "ExternalLink");
export const CornerLeftUp = icon(CornerLeftUpIcon, "CornerLeftUp");
export const CornerDownLeft = icon(CornerDownLeftIcon, "CornerDownLeft");
export const Home = icon(Home01Icon, "Home");
export const LayoutDashboard = icon(DashboardSquare01Icon, "LayoutDashboard");
export const Blocks = icon(DashboardSquare02Icon, "Blocks");
export const LayoutGrid = icon(GridViewIcon, "LayoutGrid");
export const PanelLeftIcon = icon(SidebarLeftIcon, "PanelLeftIcon");
export const Compass = icon(CompassIcon, "Compass");
export const LogIn = icon(Login01Icon, "LogIn");
export const LogOut = icon(Logout01Icon, "LogOut");
export const PowerOff = icon(PowerOffIcon, "PowerOff");

// Actions
export const Plus = icon(Add01Icon, "Plus");
export const CirclePlus = icon(AddCircleIcon, "CirclePlus");
export const Minus = icon(MinusSignIcon, "Minus");
export const MinusIcon = Minus;
export const Trash2 = icon(Delete02Icon, "Trash2");
export const Pencil = icon(PencilEdit02Icon, "Pencil");
export const PencilLine = icon(PencilEdit01Icon, "PencilLine");
export const SquarePen = icon(Edit02Icon, "SquarePen");
export const Search = icon(Search01Icon, "Search");
export const SearchIcon = Search;
export const SearchX = icon(SearchRemoveIcon, "SearchX");
export const Eye = icon(ViewIcon, "Eye");
export const EyeOff = icon(ViewOffSlashIcon, "EyeOff");
export const RotateCcw = icon(ArrowTurnBackwardIcon, "RotateCcw");
export const RotateCw = icon(ArrowTurnForwardIcon, "RotateCw");
/** Moving something on ahead of its date: the year to its next step. */
export const FastForward = icon(FastForwardIcon, "FastForward");
export const Undo2 = icon(Undo02Icon, "Undo2");
export const RefreshCw = icon(RefreshIcon, "RefreshCw");
export const Save = icon(FloppyDiskIcon, "Save");
export const Send = icon(SentIcon, "Send");
export const Play = icon(PlayIcon, "Play");
export const Rocket = icon(Rocket01Icon, "Rocket");
export const Share2 = icon(Share08Icon, "Share2");
export const Copy = icon(Copy01Icon, "Copy");
export const Link2 = icon(Link02Icon, "Link2");
export const Unlink = icon(Unlink02Icon, "Unlink");
export const Paperclip = icon(AttachmentIcon, "Paperclip");
export const MoreHorizontal = icon(MoreHorizontalGlyph, "MoreHorizontal");
export const MoreHorizontalIcon = MoreHorizontal;
export const GripVertical = icon(DragDropVerticalIcon, "GripVertical");
export const ListFilter = icon(FilterHorizontalIcon, "ListFilter");
export const SlidersHorizontal = icon(SlidersHorizontalIcon, "SlidersHorizontal");
export const Settings = icon(Settings02Icon, "Settings");
export const Settings2 = Settings;
export const Download = icon(Download04Icon, "Download");
export const Upload = icon(Upload04Icon, "Upload");
export const UploadCloud = icon(CloudUploadIcon, "UploadCloud");
export const ImageUp = icon(ImageUploadIcon, "ImageUp");
export const Maximize = icon(Maximize01Icon, "Maximize");
export const ZoomIn = icon(ZoomInAreaIcon, "ZoomIn");
export const ZoomOut = icon(ZoomOutAreaIcon, "ZoomOut");
export const Crosshair = icon(CrosshairIcon, "Crosshair");
export const Square = icon(SquareIcon, "Square");
export const Wrench = icon(Wrench01Icon, "Wrench");
export const Keyboard = icon(KeyboardIcon, "Keyboard");
export const HelpCircle = icon(HelpCircleIcon, "HelpCircle");

// Files and records
export const File = icon(File01Icon, "File");
export const FileText = icon(File02Icon, "FileText");
export const FileCheck2 = icon(FileValidationIcon, "FileCheck2");
export const FileImage = icon(Image01Icon, "FileImage");
export const FileOutput = icon(FileExportIcon, "FileOutput");
export const FileSpreadsheet = icon(FileSpreadsheetIcon, "FileSpreadsheet");
export const FileX = icon(FileRemoveIcon, "FileX");
export const ScrollText = icon(Note01Icon, "ScrollText");
export const ClipboardCheck = icon(ClipboardCheckIcon, "ClipboardCheck");
export const ClipboardList = icon(ClipboardListIcon, "ClipboardList");
export const List = icon(LeftToRightListBulletIcon, "List");
export const ListChecks = icon(TaskDone01Icon, "ListChecks");
export const Inbox = icon(InboxIcon, "Inbox");
export const Bookmark = icon(Bookmark02Icon, "Bookmark");
export const Box = icon(PackageIcon, "Box");
export const Boxes = Box;
export const History = icon(WorkHistoryIcon, "History");
export const Stamp = icon(StampIcon, "Stamp");
export const Tags = icon(Tag01Icon, "Tags");
export const Quote = icon(QuoteDownIcon, "Quote");
export const Fingerprint = icon(FingerPrintIcon, "Fingerprint");

// People and organization
export const User = icon(UserIcon, "User");
export const UserRound = User;
export const CircleUserRound = icon(UserCircleIcon, "CircleUserRound");
export const Users = icon(UserGroupIcon, "Users");
export const Users2 = Users;
export const UsersRound = Users;
export const UserPlus = icon(UserAdd01Icon, "UserPlus");
export const UserRoundPlus = UserPlus;
export const UserMinus = icon(UserMinus01Icon, "UserMinus");
export const UserX = icon(UserRemove01Icon, "UserX");
export const UserRoundX = UserX;
export const UserCheck = icon(UserCheck01Icon, "UserCheck");
export const UserRoundCheck = UserCheck;
export const UserRoundSearch = icon(UserSearch01Icon, "UserRoundSearch");
export const UserPen = icon(UserEdit01Icon, "UserPen");
export const Building = icon(Building01Icon, "Building");
export const Building2 = icon(Building03Icon, "Building2");
export const Landmark = icon(Building06Icon, "Landmark");
export const Briefcase = icon(Briefcase01Icon, "Briefcase");
export const BriefcaseBusiness = Briefcase;
export const MapPin = icon(Location01Icon, "MapPin");
export const Phone = icon(Call02Icon, "Phone");
export const Network = icon(HierarchyIcon, "Network");
export const GitBranch = icon(GitBranchIcon, "GitBranch");
export const GitMerge = icon(GitMergeIcon, "GitMerge");
export const GitPullRequestArrow = icon(GitPullRequestIcon, "GitPullRequestArrow");
export const Waypoints = icon(FlowConnectionIcon, "Waypoints");
export const Workflow = icon(WorkflowSquare01Icon, "Workflow");
export const Layers = icon(Layers01Icon, "Layers");
export const Shapes = icon(ShapesIcon, "Shapes");
export const Crown = icon(CrownIcon, "Crown");
export const HeartHandshake = icon(Agreement01Icon, "HeartHandshake");
export const Handshake = HeartHandshake;
export const Cake = icon(BirthdayCakeIcon, "Cake");
export const Gift = icon(GiftIcon, "Gift");
export const TreePalm = icon(TreePalmIcon, "TreePalm");
export const Coffee = icon(Coffee02Icon, "Coffee");
export const Camera = icon(Camera01Icon, "Camera");
export const Video = icon(Video01Icon, "Video");
export const BookOpen = icon(BookOpen01Icon, "BookOpen");
export const Award = icon(Award01Icon, "Award");
export const BrainCircuit = icon(AiBrain01Icon, "BrainCircuit");
export const Activity = icon(Activity01Icon, "Activity");

// Measures, charts and time
export const Target = icon(Target02Icon, "Target");
export const Gauge = icon(DashboardSpeed02Icon, "Gauge");
export const Flag = icon(Flag02Icon, "Flag");
export const Percent = icon(PercentIcon, "Percent");
export const Sigma = icon(SigmaIcon, "Sigma");
export const Triangle = icon(TriangleIcon, "Triangle");
export const Type = icon(TextFontIcon, "Type");
export const Lightbulb = icon(Idea01Icon, "Lightbulb");
export const TrendingUp = icon(TradeUpIcon, "TrendingUp");
export const TrendingDown = icon(TradeDownIcon, "TrendingDown");
export const LineChart = icon(ChartLineData01Icon, "LineChart");
export const BarChart3 = icon(ChartColumnIcon, "BarChart3");
export const ChartColumn = BarChart3;
export const ChartColumnBig = icon(ChartColumnBigIcon, "ChartColumnBig");
export const ChartNoAxesColumn = icon(ChartHistogramIcon, "ChartNoAxesColumn");
export const ChartNoAxesColumnIncreasing = icon(ChartBarIncreasingIcon, "ChartNoAxesColumnIncreasing");
export const ChartNoAxesCombined = icon(Analytics01Icon, "ChartNoAxesCombined");
export const PieChart = icon(PieChart02Icon, "PieChart");
export const Clock = icon(Clock01Icon, "Clock");
export const Clock3 = Clock;
export const CalendarDays = icon(Calendar03Icon, "CalendarDays");
export const CalendarIcon = CalendarDays;
export const CalendarRange = CalendarDays;
export const CalendarPlus = icon(CalendarAdd01Icon, "CalendarPlus");
export const CalendarClock = icon(CalendarClockIcon, "CalendarClock");
export const CalendarCheck = icon(CalendarCheck01Icon, "CalendarCheck");
export const Route = icon(Route02Icon, "Route");

// Messages, mail and conversations
export const Mail = icon(Mail01Icon, "Mail");
export const MailCheck = icon(MailValidation01Icon, "MailCheck");
export const MailX = icon(MailRemove01Icon, "MailX");
export const MessageSquare = icon(Message01Icon, "MessageSquare");
export const MessageSquarePlus = icon(MessageAdd01Icon, "MessageSquarePlus");
export const MessageSquareText = icon(Comment01Icon, "MessageSquareText");
export const MessagesSquare = icon(MessageMultiple01Icon, "MessagesSquare");
export const FeedbackIcon = MessagesSquare;
export const OneOnOnes = icon(Chatting01Icon, "OneOnOnes");
export const Bell = icon(Notification03Icon, "Bell");
export const ThumbsUp = icon(ThumbsUpIcon, "ThumbsUp");
export const Clapping = icon(Clapping01Icon, "Clapping");
export const Party = icon(PartyIcon, "Party");
export const PartyPopper = Party;
export const Heart = icon(FavouriteIcon, "Heart");
export const Star = icon(StarIcon, "Star");

// Look and language
export const Sun = icon(Sun03Icon, "Sun");
export const Moon = icon(Moon02Icon, "Moon");
export const Monitor = icon(ComputerIcon, "Monitor");
export const Palette = icon(PaintBoardIcon, "Palette");
export const Globe = icon(Globe02Icon, "Globe");
export const Languages = icon(LanguageSkillIcon, "Languages");

// Performance's own concepts: each measure kind has its glyph rather than one generic "object" mark.
export const Measurement = icon(RulerIcon, "Measurement");
export const NumericGoal = icon(GoalIcon, "NumericGoal");
export const Milestones = icon(MilestoneIcon, "Milestones");
export const PercentMeasure = icon(Progress02Icon, "PercentMeasure");
export const MapView = icon(HierarchySquare01Icon, "MapView");
export const ListView = icon(ListViewIcon, "ListView");
export const NineBox = icon(GridViewIcon, "NineBox");
export const Scale = icon(BalanceScaleIcon, "Scale");
export const Growth = icon(ChartIncreaseIcon, "Growth");

// AI only (D-50): drafts and the coach's suggestions, never "new" or "smart".
export const Sparkles = icon(SparklesIcon, "Sparkles");

/** An icon component, for props and tables that take one. */
export type IconComponent = Icon;
