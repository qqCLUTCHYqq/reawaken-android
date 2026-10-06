package org.reawaken.android.installer;

import android.app.Activity;
import android.os.*;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.UUID;

// Installer privilege is granted by Android's normal user permission screens.
// No root, private-save access, arbitrary destinations or game modification.
public final class MainActivity extends Activity {
  static final String GAME="com.square_enix.android_googleplay.khuxww";
  static final String[] NAMES={"main.76."+GAME+".obb","patch.87."+GAME+".obb"};
  static final String[] HASHES={"5c08d36b4456045fa44a760ebeac38792de69de7060275891fbe8e8f4f8716d8","b771b01d955e8b4f909bd2304c1266b67c357432ad651b767e46f476a60e927f"};
  static final long[] SIZES={1652397828L,533504978L};
  String token; TextView label; boolean started=false;
  @Override public void onCreate(Bundle b) {
    super.onCreate(b);token=getIntent().getStringExtra("token");
    LinearLayout layout=new LinearLayout(this);layout.setOrientation(1);layout.setPadding(32,32,32,32);
    label=new TextView(this);label.setTextSize(20);layout.addView(label);
    button(layout,"1. Allow content storage",()->requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE,Manifest.permission.WRITE_EXTERNAL_STORAGE},1));
    button(layout,"2. Allow this installer",()->startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName()))));
    button(layout,"3. Continue",()->begin(false));setContentView(layout);
    message("Re:Awaken uses this companion only when normal USB content transfer is restricted. Allow storage and this installer, then continue. You can revoke both permissions afterward.");
    if(token==null||!token.matches("[a-f0-9]{64}")){message("Open this installer from Re:Awaken on your computer.");return;}
    if(getIntent().getBooleanExtra("provisioned",false))begin(true);
  }
  void button(LinearLayout l,String text,Runnable r){Button b=new Button(this);b.setText(text);b.setOnClickListener(v->r.run());l.addView(b);}
  void message(String s){runOnUiThread(()->label.setText(s));}
  void begin(boolean provisioned) {
    if(started||token==null||!token.matches("[a-f0-9]{64}"))return;
    if(checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)!=PackageManager.PERMISSION_GRANTED||!getPackageManager().canRequestPackageInstalls()){message("Allow content storage and this installer in the Android permission screens, then continue.");return;}
    started=true;
    new Thread(()->{try{
      if(!provisioned){status("permissions-granted","Restarting the companion to refresh Android's storage view.");return;}
      probe();status("ready","Non-root package OBB write/read/delete probe passed.");
      if(getIntent().getBooleanExtra("probeOnly",false)){message("Non-root content access verified. No game content changed.");return;}
      JSONObject manifest=null;
      for(int n=0;n<600;n++){JSONObject next=new JSONObject(get("next"));if(next.optBoolean("installReady")){manifest=next;break;}Thread.sleep(1000);}
      if(manifest==null)throw new IOException("Computer did not finish APK installation.");
      if(!GAME.equals(manifest.getString("packageId")))throw new IOException("Package mismatch");
      for(int i=0;i<2;i++)place(i);
      status("complete","Both original OBBs placed and SHA-256 verified.");message("Content verified. Return to Re:Awaken on your computer.");
    }catch(Exception e){message("Stopped: "+e.getMessage());try{status("blocked",e.toString());}catch(Exception ignored){}}},"ReAwakenContent").start();
  }
  File directory(){return new File(Environment.getExternalStorageDirectory(),"Android/obb/"+GAME);}
  void probe() throws Exception {
    File d=directory();boolean created=!d.exists();if(created&&!d.mkdirs())throw new IOException("Android firmware denied installer OBB directory access");
    String[] existing=d.list();if(existing==null)throw new IOException("Cannot inspect package OBB directory");
    if(!getIntent().getBooleanExtra("probeOnly",false)&&existing.length!=0)throw new IOException("Existing OBB content; preserving it before game install");
    File f=new File(d,".reawaken-probe-"+UUID.randomUUID());
    try{try(FileOutputStream out=new FileOutputStream(f)){out.write(new byte[]{82,65,87});out.getFD().sync();}
      try(FileInputStream in=new FileInputStream(f)){if(in.read()!=82||in.read()!=65||in.read()!=87||in.read()!=-1)throw new IOException("OBB probe readback failed");}
    }finally{if(f.exists()&&!f.delete())throw new IOException("Could not remove installer probe");if(created&&d.exists()&&!d.delete())throw new IOException("Could not remove empty probe directory");}
  }
  void place(int index)throws Exception {
    File dir=directory();if(!dir.exists()&&!dir.mkdirs())throw new IOException("OBB directory denied after APK install");
    File target=new File(dir,NAMES[index]);
    if(target.exists()){if(target.length()==SIZES[index]&&HASHES[index].equals(hash(target))){status("verified",NAMES[index]+" "+HASHES[index]);return;}throw new IOException("Existing content differs; preserving it");}
    File temp=new File(dir,NAMES[index]+".reawaken-"+token.substring(0,16)+".part");
    if(temp.exists())throw new IOException("Existing partial file; stop to preserve diagnostics");
    message("Placing "+NAMES[index]);status("transferring",NAMES[index]);
    HttpURLConnection c=open("content/"+index);c.setReadTimeout(120000);
    long total=0;MessageDigest digest=MessageDigest.getInstance("SHA-256");
    try(InputStream in=c.getInputStream();FileOutputStream out=new FileOutputStream(temp)){
      byte[] buffer=new byte[1024*1024];int n;
      while((n=in.read(buffer))!=-1){total+=n;if(total>SIZES[index])throw new IOException("Unexpected content length");out.write(buffer,0,n);digest.update(buffer,0,n);}
      out.getFD().sync();
    }finally{c.disconnect();}
    if(total!=SIZES[index]||!HASHES[index].equals(hex(digest.digest()))||!HASHES[index].equals(hash(temp)))throw new IOException("Content integrity failure; partial retained");
    if(target.exists()||!temp.renameTo(target))throw new IOException("Safe final rename failed");
    if(target.length()!=SIZES[index]||!HASHES[index].equals(hash(target)))throw new IOException("Final device integrity failure");
    status("verified",NAMES[index]+" "+HASHES[index]);
  }
  String hash(File f)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(f)){byte[] b=new byte[1024*1024];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}return hex(d.digest());}
  String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format("%02x",b&255));return s.toString();}
  HttpURLConnection open(String route)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:38765/"+token+"/"+route).openConnection();c.setConnectTimeout(10000);c.setReadTimeout(10000);c.setInstanceFollowRedirects(false);return c;}
  String get(String route)throws Exception{HttpURLConnection c=open(route);try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){out.write(b,0,n);if(out.size()>16384)throw new IOException("Oversize response");}return out.toString("UTF-8");}finally{c.disconnect();}}
  void status(String phase,String detail)throws Exception{HttpURLConnection c=open("status");c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");byte[] b=new JSONObject().put("phase",phase).put("detail",detail).put("uid",android.os.Process.myUid()).toString().getBytes("UTF-8");c.setFixedLengthStreamingMode(b.length);try(OutputStream o=c.getOutputStream()){o.write(b);}try{if(c.getResponseCode()!=200)throw new IOException("Status delivery failed");}finally{c.disconnect();}}
}
