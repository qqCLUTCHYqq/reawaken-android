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
    static System.Threading.Mutex instanceGuard;
    readonly string root=Directory.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Android"))?Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Android"):AppDomain.CurrentDomain.BaseDirectory;
    readonly Label chosen=new Label(), status=new Label();
    readonly Button choose=new Button(), install=new Button(), export=new Button();
    readonly CheckBox terms=new CheckBox();
    readonly string stateRoot=Environment.GetEnvironmentVariable("REAWAKEN_ANDROID_LOCAL_TEST_STATE")??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ReAwaken","Android");
    readonly Button settings=new Button();
    System.Collections.Generic.Dictionary<string,object> preferences=new System.Collections.Generic.Dictionary<string,object>();
    string installedVersion="1.0.0-beta.1", channel="Beta"; bool updating; string[] startupArgs=new string[0];
    string AppRoot {get{return Path.GetDirectoryName(root);}}
    string SettingsFile {get{return Path.Combine(stateRoot,"settings.json");}}
    string xapk, reportFile, testSerial; bool busy; public bool TestPassed;
    const string NodeZipHash="158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541";
    const string NodeHash="ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32";
    public AndroidInstallerWindow() {
        try {var meta=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"app-version.json")));installedVersion=Convert.ToString(meta["version"]);channel=Convert.ToString(meta["defaultChannel"]);if(File.Exists(SettingsFile))preferences=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(SettingsFile));object value;if(preferences.TryGetValue("updateChannel",out value)&&(Convert.ToString(value)=="Stable"||Convert.ToString(value)=="Beta"))channel=Convert.ToString(value);if(preferences.TryGetValue("xapkLocation",out value))xapk=Convert.ToString(value);if(preferences.TryGetValue("sdkTermsAccepted",out value))terms.Checked=Convert.ToBoolean(value);}catch{MessageBox.Show("Application version or settings could not be read. Existing settings have been preserved.","Re:Awaken Android");throw;}
        Text="Re:Awaken Android "+installedVersion;ClientSize=new Size(650,650);
        Font=new Font("Segoe UI",10);StartPosition=FormStartPosition.CenterScreen;
        FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;
        var banner=new Label {Text="ANDROID BETA — PHYSICAL DEVICE TESTERS WANTED",Font=new Font("Segoe UI",12,FontStyle.Bold)};banner.SetBounds(22,15,605,32);Controls.Add(banner);
        var evidence=new Label {Text="Proven in Android 11 emulator. Not yet proven on physical hardware.\nThis separate Android beta does not change the stable iOS release."};evidence.SetBounds(22,50,605,45);Controls.Add(evidence);
        var instructions=new Label {Text="Connect one Android device with a USB data cable and unlock it.\n\nIn Settings → About device, tap Build number seven times. Open Developer options, enable USB debugging, and accept this computer's authorization prompt.\n\nChoose your own complete KHUX + Dark Road 5.0.1 WW XAPK.",AutoSize=false};
        instructions.SetBounds(22,105,605,140);Controls.Add(instructions);
        choose.Text="Choose your XAPK";choose.SetBounds(22,250,215,38);choose.Click+=(s,e)=>{using(var picker=new OpenFileDialog {Filter="User-owned XAPK (*.xapk)|*.xapk"}){if(picker.ShowDialog(this)==DialogResult.OK){xapk=picker.FileName;chosen.Text=Path.GetFileName(xapk);SavePreferences();}}};Controls.Add(choose);
        chosen.SetBounds(22,295,605,35);chosen.Text=xapk==null?"":Path.GetFileName(xapk);Controls.Add(chosen);
        terms.Text="I accept Google Android SDK terms for the required USB tools.";terms.SetBounds(22,340,605,30);Controls.Add(terms);terms.CheckedChanged+=(s,e)=>SavePreferences();
        var link=new LinkLabel {Text="Read Android SDK terms"};link.SetBounds(22,372,605,25);link.LinkClicked+=(s,e)=>Process.Start(new ProcessStartInfo("https://developer.android.com/studio/terms"){UseShellExecute=true});Controls.Add(link);
        install.Text="Install on Android";install.SetBounds(22,410,215,40);install.Click+=async(s,e)=>await Install();Controls.Add(install);
        export.Text="Export Beta Report";export.SetBounds(255,410,215,40);export.Enabled=false;export.Click+=(s,e)=>{using(var save=new SaveFileDialog {Filter="Beta report (*.json)|*.json",FileName="ReAwaken-Android-Beta-Report.json"}){if(save.ShowDialog(this)==DialogResult.OK){File.Copy(reportFile,save.FileName,true);SetStatus("Report exported. Review it, then attach it to a GitHub Issue with your device model, Android version and success/failure.");}}};Controls.Add(export);
        status.Text="Android beta. Existing game installations are preserved and refused for replacement. Keep Android connected and unlocked.";status.SetBounds(22,465,605,75);Controls.Add(status);
        var feedback=new LinkLabel {Text="Submit feedback: GitHub Issues (attach exported report)"};feedback.SetBounds(22,555,605,30);feedback.LinkClicked+=(s,e)=>Process.Start(new ProcessStartInfo("https://github.com/qqCLUTCHYqq/reawaken-android/issues"){UseShellExecute=true});Controls.Add(feedback);
        settings.Text="Settings";settings.SetBounds(22,595,130,35);settings.Click+=async(s,e)=>await ShowSettings();Controls.Add(settings);
        var versionLabel=new Label {Text="Version "+installedVersion+"  ·  "+channel+" channel"};versionLabel.SetBounds(165,600,440,28);Controls.Add(versionLabel);
        Shown+=async(s,e)=>{if(startupArgs.Length==3&&startupArgs[0]=="--update-health"){try{await UpdateCommand("health",startupArgs[1],AppRoot,startupArgs[2]);}catch{Close();return;}}else{try{var recovered=await UpdateCommand("recover",stateRoot);if(Convert.ToBoolean(recovered["recovered"])) {var restored=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"app-version.json")));installedVersion=Convert.ToString(restored["version"]);Text="Re:Awaken Android "+installedVersion;versionLabel.Text="Version "+installedVersion+"  ·  "+channel+" channel";SetStatus("An interrupted update was rolled back. Your settings and game files are preserved.");}}catch{MessageBox.Show(this,"An update is still running or requires recovery. The retained backup is in your ReAwaken Android settings folder.","Re:Awaken Android");Close();return;}}if(startupArgs.Length>0&&startupArgs[0]=="--update-rolled-back")SetStatus("Update failed; the previous version was restored. Your settings and game files are preserved.");if(startupArgs.Length==0)await CheckUpdates(false);};
        FormClosing+=(s,e)=>{if(busy&&!updating){e.Cancel=true;SetStatus("Keep this window open until installation finishes or reports a failure.");}};
    }

    void SavePreferences(){
        preferences["xapkLocation"]=xapk;preferences["sdkTermsAccepted"]=terms.Checked;preferences["updateChannel"]=channel;
        Directory.CreateDirectory(stateRoot);string temp=SettingsFile+".tmp";File.WriteAllText(temp,new JavaScriptSerializer().Serialize(preferences));if(File.Exists(SettingsFile))File.Replace(temp,SettingsFile,SettingsFile+".backup");else File.Move(temp,SettingsFile);
    }
    async Task<System.Collections.Generic.Dictionary<string,object>> UpdateCommand(params string[] args){
        string node=await Node(Path.Combine(root,"runtime-cache"));
        var list=new System.Collections.Generic.List<string>();list.Add(Path.Combine(root,"updater.mjs"));list.AddRange(args);
        var info=new ProcessStartInfo(node,String.Join(" ",list.ConvertAll(Quote))){WorkingDirectory=AppRoot,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
        using(var p=new Process {StartInfo=info}){p.Start();var output=p.StandardOutput.ReadToEndAsync();var error=p.StandardError.ReadToEndAsync();await Task.Run(()=>p.WaitForExit());string result=await output;await error;if(p.ExitCode!=0)throw new Exception("Android update check/download failed. Check your connection, release checksum or local update backup. Your game files were not changed.");return new JavaScriptSerializer {MaxJsonLength=1024*1024}.Deserialize<System.Collections.Generic.Dictionary<string,object>>(result);}
    }
    async Task ShowSettings(){
        if(busy)return;using(var dialog=new Form {Text="Settings — Re:Awaken Android",ClientSize=new Size(460,180),StartPosition=FormStartPosition.CenterParent,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false}){
            var label=new Label {Text="Installed version: "+installedVersion+"\nAndroid update channel",AutoSize=true};label.SetBounds(20,15,400,50);dialog.Controls.Add(label);
            var channels=new ComboBox {DropDownStyle=ComboBoxStyle.DropDownList};channels.Items.AddRange(new object[]{"Beta","Stable"});channels.SelectedItem=channel;channels.SetBounds(20,75,180,30);channels.SelectedIndexChanged+=(s,e)=>{channel=Convert.ToString(channels.SelectedItem);SavePreferences();};dialog.Controls.Add(channels);
            var check=new Button {Text="Check for Updates"};check.SetBounds(20,125,210,35);check.Click+=(s,e)=>{dialog.DialogResult=DialogResult.OK;dialog.Close();};dialog.Controls.Add(check);
            if(dialog.ShowDialog(this)==DialogResult.OK)await CheckUpdates(true);
        }
    }
    async Task CheckUpdates(bool manual){
        if(busy)return;busy=true;install.Enabled=choose.Enabled=settings.Enabled=false;
        try{
            var response=await UpdateCommand("check",installedVersion,channel);object value;
            if(!response.TryGetValue("update",out value)||value==null){if(manual)MessageBox.Show(this,"You have the latest available Android release in the "+channel+" channel.","Re:Awaken Android "+installedVersion);return;}
            var update=(System.Collections.Generic.Dictionary<string,object>)value;
            using(var dialog=new Form {Text="Re:Awaken Android update",ClientSize=new Size(620,440),StartPosition=FormStartPosition.CenterParent}){
                var heading=new Label {Text="Installed: "+installedVersion+" → Available: "+Convert.ToString(update["version"])+"  ("+channel+")",AutoSize=true};heading.SetBounds(15,15,590,25);dialog.Controls.Add(heading);
                var notes=new TextBox {Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,Text=Convert.ToString(update["notes"])};notes.SetBounds(15,50,590,300);dialog.Controls.Add(notes);
                var now=new Button {Text="Update Now"};now.SetBounds(15,375,180,40);now.Click+=(s,e)=>{dialog.DialogResult=DialogResult.OK;dialog.Close();};dialog.Controls.Add(now);
                var later=new Button {Text="Later"};later.SetBounds(215,375,180,40);later.Click+=(s,e)=>dialog.Close();dialog.Controls.Add(later);
                if(dialog.ShowDialog(this)!=DialogResult.OK)return;
            }
            SavePreferences();SetStatus("Downloading and checking the official Android update. Your game installation is not touched…");
            var staged=await UpdateCommand("stage",AppRoot,stateRoot,channel);
            var info=new ProcessStartInfo(Convert.ToString(staged["node"]),Quote(Convert.ToString(staged["helper"]))+" apply "+Quote(Convert.ToString(staged["plan"]))+" "+Process.GetCurrentProcess().Id){WorkingDirectory=AppRoot,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden};
            Process.Start(info);updating=true;Close();
        }catch(Exception error){if(manual)MessageBox.Show(this,error.Message,"Android update unavailable");}
        finally{if(!updating){busy=false;install.Enabled=choose.Enabled=settings.Enabled=true;}}
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
        busy=true;choose.Enabled=install.Enabled=settings.Enabled=false;
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
        }catch(Exception error){SetStatus("Stopped: "+error.Message);string cache=Path.Combine(root,"runtime-cache");Directory.CreateDirectory(cache);File.WriteAllText(Path.Combine(cache,"private-launcher-error.txt"),error.ToString());if(reportFile==null||!File.Exists(reportFile)){reportFile=Path.Combine(cache,"bootstrap-beta-report.json");File.WriteAllText(reportFile,new JavaScriptSerializer().Serialize(new {schemaVersion=1,application="Re:Awaken Android "+installedVersion,version=installedVersion,windows=new {platform="win32",version=WindowsVersion()},android=new {manufacturer="UNKNOWN",model="UNKNOWN",version="UNKNOWN",apiLevel=(int?)null,abis=new string[0]},adbConnection="NOT_CHECKED",package=new {id="com.square_enix.android_googleplay.khuxww",present="UNKNOWN"},results=new {validation="NOT_RUN",apkInstall="NOT_RUN",obbPlacement="NOT_RUN",obbHashVerification="NOT_RUN",launch="NOT_RUN"},outcome="FAIL",errors=new[]{new {source="LAUNCHER",operation="TOOL_SETUP",errorCodes=new[]{"TOOL_SETUP_FAILED"}}},logcat=new {status="NOT_COLLECTED",errorCodes=new string[0]},feedbackUrl="https://github.com/qqCLUTCHYqq/reawaken-android/issues",privacy="Fixed classifications only. No arbitrary exception text, paths or personal identifiers."}));}}
        finally{busy=false;choose.Enabled=install.Enabled=settings.Enabled=true;export.Enabled=reportFile!=null&&File.Exists(reportFile);}
    }
    [STAThread] static void Main(string[] args){bool first;string key;using(var sha=SHA256.Create()){key=BitConverter.ToString(sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(AppDomain.CurrentDomain.BaseDirectory.ToLowerInvariant()))).Replace("-","");}instanceGuard=new System.Threading.Mutex(true,"Local\\ReAwakenAndroid-"+key,out first);if(!first){MessageBox.Show("Re:Awaken Android is already open in this installation folder.","Re:Awaken Android");return;}Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);using(var form=new AndroidInstallerWindow()){form.startupArgs=args;if(args.Length==2&&args[0]=="--render-preview"){form.ShowInTaskbar=false;form.Opacity=0;form.Show();Application.DoEvents();using(var image=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(image,new Rectangle(0,0,image.Width,image.Height));image.Save(args[1],System.Drawing.Imaging.ImageFormat.Png);}form.Hide();return;}if(args.Length==3&&args[0]=="--beta-self-test"&&args[2]=="emulator-5582"){form.xapk=args[1];form.testSerial=args[2];form.terms.Checked=true;form.ShowInTaskbar=false;form.Opacity=0;form.Shown+=async(s,e)=>{await form.Install();File.WriteAllText(Path.Combine(form.root,"runtime-cache","launcher-test-result.json"),new JavaScriptSerializer().Serialize(new {passed=form.TestPassed,reportFile=form.reportFile}));Environment.ExitCode=form.TestPassed?0:1;form.Close();};}Application.Run(form);}}
}
