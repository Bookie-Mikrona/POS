import React from "react";
import { Link } from "wouter";
import { 
  Building2, 
  BookOpen, 
  FileText, 
  Users, 
  Truck, 
  Receipt, 
  BarChart3,
  ArrowRight,
  Plus,
  ArrowUpRight
} from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const MODULES = [
  { 
    id: "kontni-plan", 
    name: "Kontni plan", 
    path: "/kontni-plan", 
    icon: BookOpen,
    description: "Upravljanje sintetičnih in analitičnih kontov po SRS",
    status: "V razvoju",
    color: "text-blue-600",
    bg: "bg-blue-600/10"
  },
  { 
    id: "temeljnice", 
    name: "Temeljnice", 
    path: "/temeljnice", 
    icon: FileText,
    description: "Vnosi v glavno knjigo in pregled dnevnikov",
    status: "V razvoju",
    color: "text-emerald-600",
    bg: "bg-emerald-600/10"
  },
  { 
    id: "kupci", 
    name: "Kupci", 
    path: "/kupci", 
    icon: Users,
    description: "Izdani računi, saldakonti in terjatve",
    status: "V razvoju",
    color: "text-indigo-600",
    bg: "bg-indigo-600/10"
  },
  { 
    id: "dobavitelji", 
    name: "Dobavitelji", 
    path: "/dobavitelji", 
    icon: Truck,
    description: "Prejeti računi, saldakonti in obveznosti",
    status: "V razvoju",
    color: "text-amber-600",
    bg: "bg-amber-600/10"
  },
  { 
    id: "ddv", 
    name: "DDV evidence", 
    path: "/ddv", 
    icon: Receipt,
    description: "Knjige izdanih in prejetih računov, DDV-O obrazci",
    status: "V razvoju",
    color: "text-rose-600",
    bg: "bg-rose-600/10"
  },
  { 
    id: "porocila", 
    name: "Poročila", 
    path: "/porocila", 
    icon: BarChart3,
    description: "Bilanca stanja, izkaz poslovnega izida, bruto bilanca",
    status: "V razvoju",
    color: "text-purple-600",
    bg: "bg-purple-600/10"
  },
];

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Nadzorna plošča</h1>
          <p className="text-sm text-muted-foreground mt-1">Pregled aktivnih modulov in hitre povezave.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" asChild>
            <Link href="/temeljnice/nova">
              <Plus className="h-4 w-4 mr-2" /> Nova temeljnica
            </Link>
          </Button>
        </div>
      </div>

      {/* Quick Stats / Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Poslovno leto</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{new Date().getFullYear()}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Aktivno obdobje: 1. Jan - 31. Dec
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sistem</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">Povezano</div>
            <p className="text-xs text-muted-foreground mt-1">
              Vse storitve delujejo normalno
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Zadnja prijava</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Danes</div>
            <p className="text-xs text-muted-foreground mt-1">
              {new Date().toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </CardContent>
        </Card>
      </div>

      <h2 className="text-lg font-semibold mt-8 mb-4">Moduli sistema</h2>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MODULES.map((module) => (
          <Link key={module.id} href={module.path}>
            <Card className="h-full shadow-sm hover:shadow-md transition-shadow cursor-pointer border-border/60 hover:border-primary/30 group">
              <CardHeader className="pb-3 flex flex-row items-center gap-4">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${module.bg} ${module.color}`}>
                  <module.icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-base group-hover:text-primary transition-colors">{module.name}</CardTitle>
                  <CardDescription className="text-xs mt-1">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium">
                      {module.status}
                    </span>
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pb-4">
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {module.description}
                </p>
              </CardContent>
              <CardFooter className="pt-0 flex justify-end">
                <ArrowUpRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary transition-colors" />
              </CardFooter>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}