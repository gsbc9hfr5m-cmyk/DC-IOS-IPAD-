Pod::Spec.new do |s|
  s.name           = 'LiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'DC Cleaner Live Activity bridge'
  s.description    = 'Starts, updates and ends the deletion progress Live Activity.'
  s.author         = 'DC Cleaner'
  s.homepage       = 'https://github.com/gsbc9hfr5m-cmyk/DC-IOS-IPAD-'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '16.2' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.swift'
  s.swift_version  = '5.9'
end
