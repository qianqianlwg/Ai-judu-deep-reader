using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
// WHY：只管理本客户端创建的后台PID；持有Job句柄的管道随父进程关闭，内核清理整棵解析进程树。
public static class JuduJobGuard {
 [StructLayout(LayoutKind.Sequential)] struct Basic { public long a,b; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IO {public ulong a,b,c,d,e,f;}
 [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic basic; public IO io; public UIntPtr a,b,c,d; }
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr x,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref Extended info,int size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static void Check(bool ok){if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error());}
 public static int Main(string[] args){
  IntPtr job=IntPtr.Zero,process=IntPtr.Zero;
  try{
   int pid;if(args.Length!=1||!int.TryParse(args[0],out pid)||pid<=0)throw new ArgumentException("Invalid owned PID");
   job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero);
   Extended info=new Extended();info.basic.flags=0x2000;
   Check(SetInformationJobObject(job,9,ref info,Marshal.SizeOf(typeof(Extended))));
   process=OpenProcess(0x101,false,pid);Check(process!=IntPtr.Zero);Check(AssignProcessToJobObject(job,process));
   Console.WriteLine("JUDU_JOB_READY");Console.Out.Flush();
   while(Console.ReadLine()!=null){}
   return 0;
  }catch(Exception error){Console.Error.WriteLine("Windows Job guard: "+error.Message);return 1;}
  finally{if(process!=IntPtr.Zero)CloseHandle(process);if(job!=IntPtr.Zero)CloseHandle(job);}
 }
}
