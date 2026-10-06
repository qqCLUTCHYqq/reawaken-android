using System;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

public sealed class AndroidInstallerWindow : Form {
    readonly string root=Directory.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Android"))?Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Android"):AppDomain.CurrentDomain.BaseDirectory;
    readonly Label chosen=new Label(), status=new Label();
    readonly Button choose=new Button(), install=new Button(), export=new Button();
    readonly CheckBox terms=new CheckBox();
    string xapk, reportFile, testSerial; bool busy; public bool TestPassed;
    const string NodeZipHash="158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541";
    const string NodeHash="ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32";
    public AndroidInstallerWindow() {
        Text="Re:Awaken Android Beta 1";ClientSize=new Size(650,610);
        Font=new Font("Segoe UI",10);StartPosition=FormStartPosition.CenterScreen;
        FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;
        var banner=new Label {Text="ANDROID BETA — PHYSICAL DEVICE TESTERS WANTED",Font=new Font("Segoe UI",12,FontStyle.Bold)};banner.SetBounds(22,15,605,32);Controls.Add(banner);
        var evidence=new Label {Text="Proven in Android 11 emulator. Not yet proven on physical hardware.\nThis separate Android beta does not change the stable iOS release."};evidence.SetBounds(22,50,605,45);Controls.Add(evidence);
        var instructions=new Label {Text="Connect one Android device with a USB data cable and unlock it.\n\nIn Settings → About device, tap Build number seven times. Open Developer options, enable USB debugging, and accept this computer's authorization prompt.\n\nChoose your own complete KHUX + Dark Road 5.0.1 WW XAPK.",AutoSize=false};
        instructions.SetBounds(22,105,605,140);Controls.Add(instructions);
        choose.Text="Choose your XAPK";choose.SetBounds(22,250,215,38);choose.Click+=(s,e)=>{using(var picker=new OpenFileDialog {Filter="User-owned XAPK (*.xapk)|*.xapk"}){if(picker.ShowDialog(this)==DialogResult.OK){xapk=picker.FileName;chosen.Text=Path.GetFileName(xapk);}}};Controls.Add(choose);
        chosen.SetBounds(22,295,605,35);Controls.Add(chosen);
        terms.Text="I accept Google Android SDK terms for the required USB tools.";terms.SetBounds(22,340,605,30);Controls.Add(terms);
        var link=new LinkLabel {Text="Read Android SDK terms"};link.SetBounds(22,372,605,25);link.LinkClicked+=(s,e)=>Process.Start(new ProcessStartInfo("https://developer.android.com/studio/terms"){UseShellExecute=true});Controls.Add(link);
        install.Text="Install on Android";install.SetBounds(22,410,215,40);install.Click+=async(s,e)=>await Install();Controls.Add(install);
        export.Text="Export Beta Report";export.SetBounds(255,410,215,40);export.Enabled=false;export.Click+=(s,e)=>{using(var save=new SaveFileDialog {Filter="Beta report (*.json)|*.json",FileName="ReAwaken-Android-Beta-Report.json"}){if(save.ShowDialog(this)==DialogResult.OK){File.Copy(reportFile,save.FileName,true);SetStatus("Report exported. Review it, then attach it to a GitHub Issue with your device model, Android version and success/failure.");}}};Controls.Add(export);
        status.Text="Beta 1. Existing game installations are preserved and refused for replacement. Keep Android connected and unlocked.";status.SetBounds(22,465,605,75);Controls.Add(status);
        var feedback=new LinkLabel {Text="Submit feedback: GitHub Issues (attach exported report)"};feedback.SetBounds(22,555,605,30);feedback.LinkClicked+=(s,e)=>Process.Start(new ProcessStartInfo("https://github.com/qqCLUTCHYqq/cross-road-android/issues"){UseShellExecute=true});Controls.Add(feedback);
        FormClosing+=(s,e)=>{if(busy){e.Cancel=true;SetStatus("Keep this window open until installation finishes or reports a failure.");}};
    }
    void SetStatus(string text){if(IsDisposed)return;if(InvokeRequired){BeginInvoke((Action)(()=>status.Text=text));}else status.Text=text;}
    static string Hash(string file){using(var sha=SHA256.Create())using(var input=File.OpenRead(file)){return BitConverter.ToString(sha.ComputeHash(input)).Replace("-","").ToLowerInvariant();}}
    async Task<string> Node(string cache) {
        // Always use the managed, pinned runtime. No developer-tool setup or PATH changes.
        string bundled=Path.Combine(root,"runtime","node.exe");if(File.Exists(bundled)){if(await Task.Run(()=>Hash(bundled))!=NodeHash)throw new Exception("Bundled runtime failed integrity verification.");return bundled;}
        Directory.CreateDirectory(cache);string executable=Path.Combine(cache,"node-v24.21.0-win-x64","node.exe");
        if(File.Exists(executable)){if(await Task.Run(()=>Hash(executable))!=NodeHash)throw new Exception("Cached runtime failed integrity verification.");return executable;}
        SetStatus("Obtaining required tools from their official source…");string zip=Path.Combine(cache,"node-v24.21.0-win-x64.zip");
        using(var http=new HttpClient()){http.Timeout=TimeSpan.FromMinutes(10);using(var response=await http.GetAsync("https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip",HttpCompletionOption.ResponseHeadersRead)){response.EnsureSuccessStatusCode();using(var output=File.Create(zip))await response.Content.CopyToAsync(output);}}
        if(await Task.Run(()=>Hash(zip))!=NodeZipHash)throw new Exception("Runtime download failed integrity verification.");
        await Task.Run(()=>ZipFile.ExtractToDirectory(zip,cache));
        if(await Task.Run(()=>Hash(executable))!=NodeHash)throw new Exception("Extracted runtime failed integrity verification.");return executable;
    }
    static string Quote(string value){if(value.IndexOf('"')>=0)throw new Exception("Unexpected quote in file path.");return "\""+value.TrimEnd('\\')+"\"";}
    static string WindowsVersion(){try{using(var key=Microsoft.Win32.Registry.LocalMachine.OpenSubKey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")){string build=Convert.ToString(key.GetValue("CurrentBuildNumber")),revision=Convert.ToString(key.GetValue("UBR"));int b,r;if(Int32.TryParse(build,out b)&&Int32.TryParse(revision,out r))return "10.0."+b+"."+r;}}catch{}return Environment.OSVersion.Version.ToString();}
    async Task Install() {
        if(busy)return;
        if(xapk==null){MessageBox.Show(this,"Choose your user-owned XAPK first.","Re:Awaken");return;}
        if(!terms.Checked){MessageBox.Show(this,"Review and accept Google SDK terms before obtaining USB tools.","Re:Awaken");return;}
        busy=true;choose.Enabled=install.Enabled=false;
        try {
            string cache=Path.Combine(root,"runtime-cache"), node=await Node(cache);
            string session=Path.Combine(cache,"session-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(session);
            reportFile=Path.Combine(session,"beta-report.json");
            var argList=new System.Collections.Generic.List<string>(new string[]{Path.Combine(root,"cli.mjs"),"install","--input",xapk,"--work",session,"--accept-sdk-terms","--execute","--launch","--companion-receipt",Path.Combine(root,"companion","artifact.json")});
            if(testSerial!=null){argList.AddRange(new string[]{"--serial",testSerial,"--nonroot-emulator-test"});}
            string[] args=argList.ToArray();
            string arguments=String.Join(" ",Array.ConvertAll(args,Quote));string lastError="";
            // The explicit emulator harness supplies its isolated host profile;
            // ordinary users retain their normal Windows profile and USB workflow.
            var info=new ProcessStartInfo(node,arguments){WorkingDirectory=testSerial!=null?Environment.CurrentDirectory:root,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardOutput=true,RedirectStandardError=true};
            SetStatus("Validating your game files and detecting the authorized Android device…");
            using(var process=new Process {StartInfo=info}) {
                process.Start();Task<string> output=process.StandardOutput.ReadToEndAsync();
                Task errors=Task.Run(async()=>{string line;while((line=await process.StandardError.ReadLineAsync())!=null){lastError=line;File.AppendAllText(Path.Combine(session,"progress.txt"),line+Environment.NewLine);try{var ev=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(line);string phase=Convert.ToString(ev["phase"]);switch(phase){case "permissions-needed":SetStatus("On Android, allow content storage and this installer, then tap Continue.");break;case "installing-apk":SetStatus("Installing the original game…");break;case "transferring":SetStatus("Copying and verifying game content. Keep Android connected and unlocked.");break;case "verified":SetStatus("Content integrity verified. Finishing installation…");break;case "complete":SetStatus("Content verified. Launching the game…");break;}}catch{}}});
                await Task.Run(()=>process.WaitForExit());await errors;string json=await output;File.WriteAllText(Path.Combine(session,"result.json"),json);
                if(process.ExitCode!=0)throw new Exception(lastError.Length==0?"Installation stopped. See the local session diagnostics.":lastError);
                var result=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(json);
                if(!Convert.ToBoolean(result["nonRoot"])||!Convert.ToBoolean(result["contentVerified"])||!Convert.ToBoolean(result["launched"]))throw new Exception("Non-root transfer and launch were not fully verified.");
                TestPassed=true;
                SetStatus("Installed and verified without root. The game is open. You may revoke the companion permissions or remove the companion afterward.");
            }
        }catch(Exception error){SetStatus("Stopped: "+error.Message);string cache=Path.Combine(root,"runtime-cache");Directory.CreateDirectory(cache);File.WriteAllText(Path.Combine(cache,"private-launcher-error.txt"),error.ToString());if(reportFile==null||!File.Exists(reportFile)){reportFile=Path.Combine(cache,"bootstrap-beta-report.json");File.WriteAllText(reportFile,new JavaScriptSerializer().Serialize(new {schemaVersion=1,application="Re:Awaken Android Beta 1",version="1.0.0-beta.1",windows=new {platform="win32",version=WindowsVersion()},android=new {manufacturer="UNKNOWN",model="UNKNOWN",version="UNKNOWN",apiLevel=(int?)null,abis=new string[0]},adbConnection="NOT_CHECKED",package=new {id="com.square_enix.android_googleplay.khuxww",present="UNKNOWN"},results=new {validation="NOT_RUN",apkInstall="NOT_RUN",obbPlacement="NOT_RUN",obbHashVerification="NOT_RUN",launch="NOT_RUN"},outcome="FAIL",errors=new[]{new {source="LAUNCHER",operation="TOOL_SETUP",errorCodes=new[]{"TOOL_SETUP_FAILED"}}},logcat=new {status="NOT_COLLECTED",errorCodes=new string[0]},feedbackUrl="https://github.com/qqCLUTCHYqq/cross-road-android/issues",privacy="Fixed classifications only. No arbitrary exception text, paths or personal identifiers."}));}}
        finally{busy=false;choose.Enabled=install.Enabled=true;export.Enabled=reportFile!=null&&File.Exists(reportFile);}
    }
    [STAThread] static void Main(string[] args){Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);using(var form=new AndroidInstallerWindow()){if(args.Length==2&&args[0]=="--render-preview"){form.ShowInTaskbar=false;form.Opacity=0;form.Show();Application.DoEvents();using(var image=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(image,new Rectangle(0,0,image.Width,image.Height));image.Save(args[1],System.Drawing.Imaging.ImageFormat.Png);}form.Hide();return;}if(args.Length==3&&args[0]=="--beta-self-test"&&args[2]=="emulator-5582"){form.xapk=args[1];form.testSerial=args[2];form.terms.Checked=true;form.ShowInTaskbar=false;form.Opacity=0;form.Shown+=async(s,e)=>{await form.Install();File.WriteAllText(Path.Combine(form.root,"runtime-cache","launcher-test-result.json"),new JavaScriptSerializer().Serialize(new {passed=form.TestPassed,reportFile=form.reportFile}));Environment.ExitCode=form.TestPassed?0:1;form.Close();};}Application.Run(form);}}
}
